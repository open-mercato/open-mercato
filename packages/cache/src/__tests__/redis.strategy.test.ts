/** @jest-environment node */
import type { CacheStrategy } from '../types'
import { createRedisStrategy, pickRedisConstructor } from '../strategies/redis'

type PipelineOp = () => void

class FakeRedis {
  values = new Map<string, string | Buffer>()
  sets = new Map<string, Set<string>>()
  /** Records the shape of each reap script call so tests can assert its cost. */
  evalCalls: { numKeys: number; memberCount: number }[] = []

  async ping(): Promise<string> {
    return 'PONG'
  }

  async get(key: string): Promise<string | null> {
    const value = this.values.get(key)
    if (value === undefined) return null
    return Buffer.isBuffer(value) ? value.toString('utf8') : value
  }

  async getBuffer(key: string): Promise<Buffer | null> {
    const value = this.values.get(key)
    if (value === undefined) return null
    return Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8')
  }

  async set(key: string, value: string | Buffer): Promise<unknown> {
    this.values.set(key, value)
    return 'OK'
  }

  async setex(key: string, _ttlSeconds: number, value: string | Buffer): Promise<unknown> {
    this.values.set(key, value)
    return 'OK'
  }

  async del(key: string): Promise<unknown> {
    return this.values.delete(key) ? 1 : 0
  }

  async exists(key: string): Promise<number> {
    return this.values.has(key) ? 1 : 0
  }

  async keys(pattern: string): Promise<string[]> {
    const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern
    return [...this.values.keys()].filter((key) => key.startsWith(prefix))
  }

  async smembers(key: string): Promise<string[]> {
    return [...(this.sets.get(key) ?? [])]
  }

  /**
   * Mirrors the reap script's KEYS/ARGV contract rather than interpreting Lua —
   * there is no Lua runtime here, and pulling one in for a single script is not
   * worth the dependency. What this pins down is the strategy's side of the
   * contract (key ordering, member alignment, chunking) and the exists-guarded
   * semantics. The script *body* is not covered; verify it against a real Redis
   * when changing it.
   */
  runEval(_script: string, numKeys: number, ...args: (string | number)[]): number {
    const [tagKey, ...valueKeys] = args.slice(0, numKeys) as string[]
    const members = args.slice(numKeys).map(String)

    if (valueKeys.length !== members.length) {
      throw new Error(`[internal] eval contract: ${valueKeys.length} value keys vs ${members.length} members`)
    }

    let removed = 0
    for (const [index, valueKey] of valueKeys.entries()) {
      if (this.values.has(valueKey)) continue
      const set = this.sets.get(tagKey)
      if (!set?.delete(members[index])) continue
      removed++
      if (set.size === 0) this.sets.delete(tagKey)
    }
    return removed
  }

  pipeline() {
    const ops: PipelineOp[] = []
    const chain = {
      set: (key: string, value: string | Buffer) => {
        ops.push(() => void this.values.set(key, value))
        return chain
      },
      setex: (key: string, _ttlSeconds: number, value: string | Buffer) => {
        ops.push(() => void this.values.set(key, value))
        return chain
      },
      sadd: (key: string, member: string) => {
        ops.push(() => {
          const members = this.sets.get(key) ?? new Set<string>()
          members.add(member)
          this.sets.set(key, members)
        })
        return chain
      },
      srem: (key: string, member: string) => {
        ops.push(() => {
          const members = this.sets.get(key)
          if (!members) return
          members.delete(member)
          // Redis drops a set once its last member is removed.
          if (members.size === 0) this.sets.delete(key)
        })
        return chain
      },
      del: (key: string) => {
        ops.push(() => void this.values.delete(key))
        return chain
      },
      eval: (script: string, numKeys: number, ...args: (string | number)[]) => {
        this.evalCalls.push({ numKeys, memberCount: args.length - numKeys })
        ops.push(() => void this.runEval(script, numKeys, ...args))
        return chain
      },
      exec: async () => {
        for (const op of ops) op()
        ops.length = 0
        return []
      },
    }
    return chain
  }

  async quit(): Promise<void> {}

  /** Simulate a TTL firing: Redis expiry deletes the value key and nothing else. */
  expire(cacheKey: string): void {
    this.values.delete(cacheKey)
  }
}

let currentRedis: FakeRedis
let lastConstructorArgs: unknown[] = []

jest.mock('ioredis', () => ({
  __esModule: true,
  default: class {
    constructor(...args: unknown[]) {
      lastConstructorArgs = args
      return currentRedis as unknown as object
    }
  },
}))

describe('redis strategy tag index', () => {
  let strategy: CacheStrategy
  let urlCounter = 0

  beforeEach(() => {
    currentRedis = new FakeRedis()
    urlCounter += 1
    // The client registry is module-global and keyed by URL; keep runs isolated.
    strategy = createRedisStrategy(`redis://cache-test-${urlCounter}`)
  })

  afterEach(async () => {
    await strategy.close?.()
  })

  it('pins the wire protocol to RESP2 so ioredis 6 keeps the v5 reply shapes', async () => {
    await strategy.set('protocol-probe', { ok: true }, { ttl: 60_000 })
    expect(lastConstructorArgs[1]).toMatchObject({ protocol: 2 })
  })

  it('reaps tag members whose value key already expired', async () => {
    await strategy.set('nav:sidebar:abc123:pl:user-1', { groups: [] }, { ttl: 60_000, tags: ['rbac:tenant:t1'] })
    expect(await currentRedis.smembers('tag:rbac:tenant:t1')).toEqual(['nav:sidebar:abc123:pl:user-1'])

    currentRedis.expire('cache:nav:sidebar:abc123:pl:user-1')

    const deleted = await strategy.deleteByTags(['rbac:tenant:t1'])

    expect(deleted).toBe(0)
    expect(await currentRedis.smembers('tag:rbac:tenant:t1')).toEqual([])
  })

  it('does not accumulate members when TTL entries rotate their key names', async () => {
    for (const fingerprint of ['abc123', 'def456', 'ghi789']) {
      const key = `nav:sidebar:${fingerprint}:pl:user-1`
      await strategy.set(key, { groups: [] }, { ttl: 60_000, tags: ['rbac:tenant:t1'] })
      currentRedis.expire(`cache:${key}`)
      await strategy.deleteByTags(['rbac:tenant:t1'])
    }

    expect(await currentRedis.smembers('tag:rbac:tenant:t1')).toEqual([])
  })

  it('leaves live keys in the tag index alone and still reports them deleted', async () => {
    await strategy.set('live', { value: 1 }, { ttl: 60_000, tags: ['rbac:tenant:t1'] })
    await strategy.set('expired', { value: 2 }, { ttl: 60_000, tags: ['rbac:tenant:t1'] })
    currentRedis.expire('cache:expired')

    const deleted = await strategy.deleteByTags(['rbac:tenant:t1'])

    expect(deleted).toBe(1)
    expect(await currentRedis.smembers('tag:rbac:tenant:t1')).toEqual([])
    expect(await strategy.get('live')).toBeNull()
  })

  it('keeps a key indexed when a concurrent write rebuilds it mid-walk', async () => {
    await strategy.set('nav:user-1', { v: 'old' }, { ttl: 60_000, tags: ['rbac:tenant:t1'] })
    currentRedis.expire('cache:nav:user-1')

    // deleteByTags walks members one round trip at a time, so an entry it read
    // as missing can be rebuilt before the reap runs. Land that write in the
    // window by hooking the GET that reports the key absent.
    const readValue = currentRedis.getBuffer.bind(currentRedis)
    let rebuilt = false
    currentRedis.getBuffer = async (key: string) => {
      const result = await readValue(key)
      if (!rebuilt && key === 'cache:nav:user-1' && result === null) {
        rebuilt = true
        await strategy.set('nav:user-1', { v: 'fresh' }, { ttl: 60_000, tags: ['rbac:tenant:t1'] })
      }
      return result
    }

    await strategy.deleteByTags(['rbac:tenant:t1'])
    currentRedis.getBuffer = readValue

    // The rebuilt entry must stay in the index, or it silently outlives every
    // future invalidation of this tag and serves stale data until its TTL.
    expect(await currentRedis.smembers('tag:rbac:tenant:t1')).toEqual(['nav:user-1'])
    expect(await strategy.deleteByTags(['rbac:tenant:t1'])).toBe(1)
    expect(await strategy.get('nav:user-1')).toBeNull()
  })

  it('reaps orphans spanning multiple chunks', async () => {
    const keyCount = 600 // REAP_CHUNK_SIZE is 256, so this spans three chunks.
    for (let index = 0; index < keyCount; index++) {
      const key = `bulk-${index}`
      await strategy.set(key, { index }, { ttl: 60_000, tags: ['rbac:tenant:t1'] })
      currentRedis.expire(`cache:${key}`)
    }
    expect((await currentRedis.smembers('tag:rbac:tenant:t1')).length).toBe(keyCount)

    expect(await strategy.deleteByTags(['rbac:tenant:t1'])).toBe(0)
    expect(await currentRedis.smembers('tag:rbac:tenant:t1')).toEqual([])
  })

  it('keeps reap work linear in real memberships across disjoint tags', async () => {
    const tagCount = 10
    const perTag = 10
    for (let tag = 0; tag < tagCount; tag++) {
      for (let index = 0; index < perTag; index++) {
        const key = `t${tag}-k${index}`
        await strategy.set(key, { index }, { ttl: 60_000, tags: [`tag-${tag}`] })
        currentRedis.expire(`cache:${key}`)
      }
    }

    currentRedis.evalCalls = []
    await strategy.deleteByTags(Array.from({ length: tagCount }, (_, tag) => `tag-${tag}`))

    // Pairing every orphan with every requested tag would make this tagCount
    // times larger — 1000 removals to clear 100 real memberships.
    const removals = currentRedis.evalCalls.reduce((total, call) => total + call.memberCount, 0)
    expect(removals).toBe(tagCount * perTag)

    // No single atomic call may exceed the chunk bound, whatever the tag count.
    for (const call of currentRedis.evalCalls) {
      expect(call.memberCount).toBeLessThanOrEqual(256)
      expect(call.numKeys).toBeLessThanOrEqual(256 + 1)
    }

    for (let tag = 0; tag < tagCount; tag++) {
      expect(await currentRedis.smembers(`tag:tag-${tag}`)).toEqual([])
    }
  })

  it('only reaps orphans from the tags it was asked to invalidate', async () => {
    await strategy.set('key-1', { value: 1 }, { ttl: 60_000, tags: ['tag-a', 'tag-b'] })
    currentRedis.expire('cache:key-1')

    await strategy.deleteByTags(['tag-a'])

    expect(await currentRedis.smembers('tag:tag-a')).toEqual([])
    expect(await currentRedis.smembers('tag:tag-b')).toEqual(['key-1'])
  })
})

describe('redis strategy value compression', () => {
  let urlCounter = 0
  const largeValue = {
    items: Array.from({ length: 100 }, (_, index) => ({ id: `row-${index}`, name: `Contact ${index}`, status: 'active' })),
  }

  function createStrategy(compression: 'off' | 'zstd' | 'gzip'): CacheStrategy {
    urlCounter += 1
    return createRedisStrategy(`redis://cache-compression-test-${urlCounter}`, { compression })
  }

  beforeEach(() => {
    currentRedis = new FakeRedis()
  })

  it.each([
    ['zstd', [0x28, 0xb5, 0x2f, 0xfd]],
    ['gzip', [0x1f, 0x8b]],
  ] as const)('stores large entries as %s frames and reads them back', async (compression, magic) => {
    const strategy = createStrategy(compression)

    await strategy.set('list:page:1', largeValue, { ttl: 60_000, tags: ['customers'] })

    const stored = currentRedis.values.get('cache:list:page:1')
    expect(Buffer.isBuffer(stored)).toBe(true)
    expect(magic.every((byte, index) => (stored as Buffer)[index] === byte)).toBe(true)
    expect(await strategy.get('list:page:1')).toEqual(largeValue)
    expect(await strategy.has('list:page:1')).toBe(true)
    await strategy.close?.()
  })

  it('keeps small entries as plain JSON strings', async () => {
    const strategy = createStrategy('zstd')

    await strategy.set('small', { id: 1 })

    expect(typeof currentRedis.values.get('cache:small')).toBe('string')
    expect(await strategy.get('small')).toEqual({ id: 1 })
    await strategy.close?.()
  })

  it('reads legacy and compressed entries side by side in either direction', async () => {
    const legacy = createStrategy('off')
    await legacy.set('legacy', largeValue)
    const compressed = createStrategy('zstd')
    await compressed.set('compressed', largeValue)

    expect(typeof currentRedis.values.get('cache:legacy')).toBe('string')
    expect(await compressed.get('legacy')).toEqual(largeValue)
    expect(await legacy.get('compressed')).toEqual(largeValue)
    await legacy.close?.()
    await compressed.close?.()
  })

  it('moves tag memberships when a compressed entry is overwritten', async () => {
    const strategy = createStrategy('zstd')

    await strategy.set('list', largeValue, { tags: ['old-tag'] })
    await strategy.set('list', largeValue, { tags: ['new-tag'] })

    expect(await currentRedis.smembers('tag:old-tag')).toEqual([])
    expect(await currentRedis.smembers('tag:new-tag')).toEqual(['list'])
    expect(await strategy.deleteByTags(['new-tag'])).toBe(1)
    expect(currentRedis.values.has('cache:list')).toBe(false)
    expect(await currentRedis.smembers('tag:new-tag')).toEqual([])
    await strategy.close?.()
  })

  it('counts and cleans up expired compressed entries', async () => {
    const strategy = createStrategy('gzip')
    await strategy.set('fresh', largeValue, { ttl: 60_000, tags: ['t'] })
    await strategy.set('stale', largeValue, { ttl: 1, tags: ['t'] })
    await new Promise((resolve) => setTimeout(resolve, 5))

    expect(await strategy.stats()).toEqual({ size: 2, expired: 1 })
    expect(await strategy.cleanup?.()).toBe(1)
    expect(currentRedis.values.has('cache:fresh')).toBe(true)
    expect(currentRedis.values.has('cache:stale')).toBe(false)
    expect(await currentRedis.smembers('tag:t')).toEqual(['fresh'])
    await strategy.close?.()
  })

  it('drops a corrupt frame as a miss', async () => {
    const strategy = createStrategy('zstd')
    currentRedis.values.set('cache:broken', Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0xff, 0xff, 0xff]))

    expect(await strategy.get('broken')).toBeNull()
    expect(currentRedis.values.has('cache:broken')).toBe(false)
    await strategy.close?.()
  })
})

describe('pickRedisConstructor', () => {
  class RealRedis {
    args: unknown[]
    constructor(...args: unknown[]) {
      this.args = args
    }
  }

  it('resolves a plain CommonJS require, where module.exports is the class itself', () => {
    const mod = RealRedis as unknown as { default: unknown; Redis: unknown }
    mod.default = RealRedis
    mod.Redis = RealRedis

    const ctor = pickRedisConstructor(mod)

    expect(ctor).toBe(RealRedis)
    expect(new ctor!()).toBeInstanceOf(RealRedis)
  })

  it('resolves a real Node ESM namespace, where .default is the class and the namespace is a plain object', () => {
    const mod = { default: RealRedis, Redis: RealRedis }

    const ctor = pickRedisConstructor(mod)

    expect(ctor).toBe(RealRedis)
    expect(new ctor!()).toBeInstanceOf(RealRedis)
  })

  it('resolves a Turbopack-wrapped callable namespace by preferring .default/.Redis over the wrapper', () => {
    // Mirrors Turbopack's `createNS`: a plain function that forwards to the
    // real class via `.apply`, which is callable but throws when invoked
    // with `new` because `apply` always calls the class as a plain function.
    const wrapper = function (this: unknown, ...args: unknown[]) {
      return RealRedis.apply(this, args)
    } as unknown as { default: unknown; Redis: unknown }
    wrapper.default = RealRedis
    wrapper.Redis = RealRedis

    const ctor = pickRedisConstructor(wrapper)

    expect(ctor).toBe(RealRedis)
    expect(new ctor!()).toBeInstanceOf(RealRedis)
    expect(() => new (wrapper as unknown as new () => unknown)()).toThrow(TypeError)
  })

  it('returns null when nothing usable is found', () => {
    expect(pickRedisConstructor({})).toBeNull()
    expect(pickRedisConstructor(null)).toBeNull()
    expect(pickRedisConstructor(undefined)).toBeNull()
  })
})
