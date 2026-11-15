/** @jest-environment node */
import type { CacheStrategy } from '../types'
import { createRedisStrategy, pickRedisConstructor } from '../strategies/redis'

type PipelineOp = () => unknown | Promise<unknown>
type RedisArgument = string | number | Buffer

class FakeRedis {
  values = new Map<string, string | Buffer>()
  sets = new Map<string, Set<string>>()
  scanCalls: { cursor: string; pattern: string; count: number }[] = []
  scriptedScanPages = new Map<string, [string, string[]][]>()
  private scanSnapshots = new Map<string, string[]>()

  private matches(key: string, pattern: string): boolean {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    const expression = escaped.replace(/\*/g, '.*').replace(/\?/g, '.')
    return new RegExp(`^${expression}$`).test(key)
  }
  /** Records the shape of each reap script call so tests can assert its cost. */
  evalCalls: { kind: 'orphan' | 'stale'; tagKey: string; numKeys: number; memberCount: number }[] = []
  multiExecCalls = 0

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

  async del(...keys: string[]): Promise<number> {
    let deleted = 0
    for (const key of keys) {
      const existed = this.values.delete(key)
      const setExisted = this.sets.delete(key)
      if (existed || setExisted) deleted++
    }
    return deleted
  }

  async exists(key: string): Promise<number> {
    return this.values.has(key) || this.sets.has(key) ? 1 : 0
  }

  async keys(pattern: string): Promise<string[]> {
    return [...new Set([...this.values.keys(), ...this.sets.keys()])].filter((key) => this.matches(key, pattern))
  }

  async scan(cursor: string, ...args: (string | number)[]): Promise<[string, string[]]> {
    const matchIndex = args.findIndex((value) => String(value).toUpperCase() === 'MATCH')
    const countIndex = args.findIndex((value) => String(value).toUpperCase() === 'COUNT')
    const pattern = matchIndex < 0 ? '*' : String(args[matchIndex + 1])
    const count = countIndex < 0 ? 10 : Number(args[countIndex + 1])
    this.scanCalls.push({ cursor: String(cursor), pattern, count })
    const scripted = this.scriptedScanPages.get(pattern)
    if (scripted) {
      const next = scripted.shift()
      if (!next) throw new Error(`Unexpected extra SCAN for ${pattern}`)
      return next
    }

    // Stable keys model a cursor walk while clear/cleanup delete earlier pages.
    if (String(cursor) === '0') {
      const allKeys = [...new Set([...this.values.keys(), ...this.sets.keys()])]
      this.scanSnapshots.set(pattern, allKeys.filter((key) => this.matches(key, pattern)))
    }
    const snapshot = this.scanSnapshots.get(pattern) ?? []
    const offset = Number(cursor)
    // COUNT is a hint. Small pages force callers to visit the complete cursor.
    const end = Math.min(offset + Math.min(count, 2), snapshot.length)
    return [end >= snapshot.length ? '0' : String(end), snapshot.slice(offset, end)]
  }

  async mgetBuffer(...keys: string[]): Promise<(Buffer | null)[]> {
    // Preserve getBuffer hooks used to land concurrent writes in a read window.
    return Promise.all(keys.map((key) => this.getBuffer(key)))
  }

  async smembers(key: string): Promise<string[]> {
    return [...(this.sets.get(key) ?? [])]
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    const existing = this.sets.get(key) ?? new Set<string>()
    const oldSize = existing.size
    for (const member of members) existing.add(member)
    if (existing.size) this.sets.set(key, existing)
    return existing.size - oldSize
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    const existing = this.sets.get(key)
    if (!existing) return 0
    let removed = 0
    for (const member of members) if (existing.delete(member)) removed++
    if (!existing.size) this.sets.delete(key)
    return removed
  }

  async eval(script: string, numKeys: number, ...args: RedisArgument[]): Promise<unknown> {
    const stale = args.slice(numKeys).some(Buffer.isBuffer)
    this.evalCalls.push({
      kind: stale ? 'stale' : 'orphan', tagKey: String(args[0]), numKeys,
      memberCount: (args.length - numKeys) / (stale ? 2 : 1),
    })
    return this.runEval(script, numKeys, ...args)
  }

  /**
   * Mirrors the reap scripts' KEYS/ARGV contracts rather than interpreting Lua —
   * there is no Lua runtime here, and pulling one in for a single script is not
   * worth the dependency. What this pins down is the strategy's side of the
   * contract (key ordering, member alignment, chunking) and the exists-guarded
   * semantics and byte-guarded stale-member removal. The script bodies are not
   * covered; verify them against a real Redis
   * when changing it.
   */
  async runEval(script: string, numKeys: number, ...args: RedisArgument[]): Promise<unknown> {
    const keys = args.slice(0, numKeys).map(String)
    const [tagKey, ...valueKeys] = keys
    const argv = args.slice(numKeys)
    const stale = argv.some(Buffer.isBuffer)
    if (stale) {
      if (argv.length !== valueKeys.length * 2) throw new Error('[internal] stale eval argument alignment')
      let removed = 0
      for (let index = 0; index < valueKeys.length; index++) {
        const member = String(argv[index * 2])
        const observed = argv[index * 2 + 1]
        if (!Buffer.isBuffer(observed) || valueKeys[index] !== `cache:${member}`) {
          throw new Error('[internal] stale eval member/value/buffer alignment')
        }
        // Model Redis's byte comparison without routing the atomic script read
        // through a client-side hook used to inject concurrent set() calls.
        const stored = this.values.get(valueKeys[index])
        const current = stored === undefined ? null : Buffer.isBuffer(stored) ? stored : Buffer.from(stored)
        if (current !== null && !current.equals(observed)) continue
        removed += await this.srem(tagKey, member)
      }
      return removed
    }
    const members = argv.map(String)

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
        ops.push(() => this.set(key, value))
        return chain
      },
      setex: (key: string, ttlSeconds: number, value: string | Buffer) => {
        ops.push(() => this.setex(key, ttlSeconds, value))
        return chain
      },
      getBuffer: (key: string) => {
        ops.push(() => this.getBuffer(key))
        return chain
      },
      smembers: (key: string) => {
        ops.push(() => this.smembers(key))
        return chain
      },
      sadd: (key: string, ...members: string[]) => {
        ops.push(() => this.sadd(key, ...members))
        return chain
      },
      srem: (key: string, ...members: string[]) => {
        ops.push(() => this.srem(key, ...members))
        return chain
      },
      del: (...keys: string[]) => {
        ops.push(() => this.del(...keys))
        return chain
      },
      eval: (script: string, numKeys: number, ...args: RedisArgument[]) => {
        ops.push(() => this.eval(script, numKeys, ...args))
        return chain
      },
      exec: async (): Promise<[Error | null, unknown][]> => {
        const results: [Error | null, unknown][] = []
        for (const op of ops) {
          try {
            results.push([null, await op()])
          } catch (error) {
            results.push([error instanceof Error ? error : new Error(String(error)), null])
          }
        }
        ops.length = 0
        return results
      },
    }
    return chain
  }

  multi() {
    // Shares the command-result model with pipeline. This fake does not prove
    // server transaction isolation; the live Redis suite covers the wire path.
    const transaction = this.pipeline()
    const execute = transaction.exec
    transaction.exec = async () => {
      this.multiExecCalls++
      return execute()
    }
    return transaction
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

describe('redis strategy transaction writes and lazy tag memberships', () => {
  let strategy: CacheStrategy
  let urlCounter = 0

  beforeEach(() => {
    currentRedis = new FakeRedis()
    urlCounter += 1
    strategy = createRedisStrategy(`redis://cache-lazy-tags-${urlCounter}`)
  })

  afterEach(async () => {
    await strategy.close?.()
  })

  it.each([
    { name: 'new TTL entry', overwrite: false, ttl: 1501, tags: ['products'] },
    { name: 'overwritten TTL entry', overwrite: true, ttl: 60_000, tags: ['new-products'] },
    { name: 'tagless overwrite without TTL', overwrite: true, ttl: 0, tags: [] },
    { name: 'new tagless entry without TTL', overwrite: false, ttl: 0, tags: [] },
  ])('writes $name in one checked transaction without reading the previous value', async ({ overwrite, ttl, tags }) => {
    if (overwrite) await strategy.set('product', 'old', { tags: ['old-products'] })
    const read = jest.spyOn(currentRedis, 'getBuffer').mockRejectedValue(new Error('set must not read'))
    const readText = jest.spyOn(currentRedis, 'get').mockRejectedValue(new Error('set must not read'))
    const transaction = jest.spyOn(currentRedis, 'multi')
    const set = jest.spyOn(currentRedis, 'set')
    const setex = jest.spyOn(currentRedis, 'setex')
    currentRedis.multiExecCalls = 0

    await strategy.set('product', 'fresh', { ttl, tags })

    expect(read).not.toHaveBeenCalled()
    expect(readText).not.toHaveBeenCalled()
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(currentRedis.multiExecCalls).toBe(1)
    const stored = JSON.parse(String(currentRedis.values.get('cache:product')))
    expect(stored).toMatchObject({ key: 'product', value: 'fresh', tags })
    if (ttl) {
      expect(setex).toHaveBeenCalledWith('cache:product', Math.ceil(ttl / 1000), expect.any(String))
      expect(set).not.toHaveBeenCalled()
      expect(stored.expiresAt).toBeGreaterThan(stored.createdAt)
    } else {
      expect(set).toHaveBeenCalledTimes(1)
      expect(setex).not.toHaveBeenCalled()
      expect(stored.expiresAt).toBeNull()
    }
    for (const tag of tags) expect(await currentRedis.smembers(`tag:${tag}`)).toEqual(['product'])
  })

  it('keeps the live retagged entry when invalidating its previous tag', async () => {
    await strategy.set('product', 'old', { tags: ['old-products'] })
    await strategy.set('product', 'fresh', { tags: ['new-products'] })
    expect(await currentRedis.smembers('tag:old-products')).toEqual(['product'])

    expect(await strategy.deleteByTags(['old-products'])).toBe(0)
    expect(await strategy.get('product')).toBe('fresh')
    expect(await currentRedis.smembers('tag:old-products')).toEqual([])
    expect(await currentRedis.smembers('tag:new-products')).toEqual(['product'])
    expect(await strategy.deleteByTags(['new-products'])).toBe(1)
    expect(await strategy.get('product')).toBeNull()
  })

  it('deduplicates overlapping requested old and current tags and cleans both memberships', async () => {
    await strategy.set('product', 'old', { tags: ['old-products'] })
    await strategy.set('product', 'fresh', { tags: ['new-products'] })

    expect(await strategy.deleteByTags(['old-products', 'new-products', 'old-products'])).toBe(1)
    expect(await strategy.get('product')).toBeNull()
    expect(await currentRedis.smembers('tag:old-products')).toEqual([])
    expect(await currentRedis.smembers('tag:new-products')).toEqual([])
    expect(await strategy.deleteByTags(['old-products', 'new-products'])).toBe(0)
  })

  it('retains an entry rewritten with no tags when invalidating its previous tag', async () => {
    await strategy.set('product', 'old', { tags: ['products'] })
    await strategy.set('product', 'fresh', { tags: [] })

    expect(await strategy.deleteByTags(['products'])).toBe(0)
    expect(await strategy.get('product')).toBe('fresh')
    expect(await currentRedis.smembers('tag:products')).toEqual([])
    expect(await strategy.delete('product')).toBe(true)
  })

  it('does not reap a tag reintroduced after the invalidation snapshot', async () => {
    await strategy.set('product', 'old', { tags: ['products'] })
    await strategy.set('product', 'retagged', { tags: ['other-products'] })
    const read = currentRedis.getBuffer.bind(currentRedis)
    let rewritten = false
    currentRedis.getBuffer = async (key) => {
      const observed = await read(key)
      if (!rewritten && key === 'cache:product' && observed !== null) {
        rewritten = true
        await strategy.set('product', 'reintroduced', { tags: ['products'] })
      }
      return observed
    }

    expect(await strategy.deleteByTags(['products'])).toBe(0)
    expect(rewritten).toBe(true)
    expect(await strategy.get('product')).toBe('reintroduced')
    expect(await currentRedis.smembers('tag:products')).toEqual(['product'])
    expect(await strategy.deleteByTags(['products'])).toBe(1)
  })

  it('passes compressed snapshots to stale reaping as exact binary bytes', async () => {
    const compressed = createRedisStrategy(`redis://cache-lazy-binary-${++urlCounter}`, { compression: 'gzip' })
    const value = { detail: 'Agram frozen vegetables and fruit '.repeat(300) }
    try {
      await compressed.set('product', value, { tags: ['old-products'] })
      await compressed.set('product', value, { tags: ['new-products'] })
      const observed = currentRedis.values.get('cache:product')
      expect(Buffer.isBuffer(observed)).toBe(true)
      const evaluate = jest.spyOn(currentRedis, 'eval')

      expect(await compressed.deleteByTags(['old-products'])).toBe(0)
      const binaryArguments = evaluate.mock.calls.flatMap((call) => call.slice(2)).filter(Buffer.isBuffer)
      expect(binaryArguments).toHaveLength(1)
      expect(binaryArguments[0]).toEqual(observed)
      expect(await compressed.get('product')).toEqual(value)
      expect(await currentRedis.smembers('tag:old-products')).toEqual([])
      expect(await currentRedis.smembers('tag:new-products')).toEqual(['product'])
    } finally {
      await compressed.close?.()
    }
  })

  it('keeps stale reaping linear in actual memberships and bounded across disjoint tags', async () => {
    const perTag = 300
    for (let tag = 0; tag < 2; tag++) {
      for (let index = 0; index < perTag; index++) {
        const key = `group-${tag}-product-${index}`
        await strategy.set(key, 'old', { tags: [`old-group-${tag}`] })
        await strategy.set(key, 'fresh', { tags: [`new-group-${tag}`] })
      }
    }
    currentRedis.evalCalls = []

    expect(await strategy.deleteByTags(['old-group-0', 'old-group-1'])).toBe(0)
    const staleCalls = currentRedis.evalCalls.filter(({ kind }) => kind === 'stale')
    expect(staleCalls.reduce((sum, call) => sum + call.memberCount, 0)).toBe(perTag * 2)
    for (const call of staleCalls) {
      expect(call.memberCount).toBeGreaterThan(0)
      expect(call.memberCount).toBeLessThanOrEqual(256)
      expect(call.numKeys).toBe(call.memberCount + 1)
    }
    for (let tag = 0; tag < 2; tag++) {
      expect(staleCalls.filter(({ tagKey }) => tagKey === `tag:old-group-${tag}`)
        .reduce((sum, call) => sum + call.memberCount, 0)).toBe(perTag)
      expect(await currentRedis.smembers(`tag:old-group-${tag}`)).toEqual([])
      expect(await currentRedis.smembers(`tag:new-group-${tag}`)).toHaveLength(perTag)
      expect(await strategy.get(`group-${tag}-product-${perTag - 1}`)).toBe('fresh')
    }
  })

  it('still deletes corrupt values reachable through a requested tag', async () => {
    await strategy.set('product', 'old', { tags: ['products'] })
    currentRedis.values.set('cache:product', '{invalid JSON')

    expect(await strategy.deleteByTags(['products'])).toBe(1)
    expect(currentRedis.values.has('cache:product')).toBe(false)
  })

  it.each(['setex', 'sadd'] as const)('propagates a %s error from the write transaction', async (command) => {
    jest.spyOn(currentRedis, command).mockRejectedValueOnce(new Error(`injected ${command} failure`))

    await expect(strategy.set('product', 'fresh', { ttl: 60_000, tags: ['products'] }))
      .rejects.toThrow(`injected ${command} failure`)
    expect(currentRedis.multiExecCalls).toBe(1)
  })

  it('propagates a stale-reaping pipeline error', async () => {
    await strategy.set('product', 'old', { tags: ['old-products'] })
    await strategy.set('product', 'fresh', { tags: ['new-products'] })
    jest.spyOn(currentRedis, 'eval').mockRejectedValueOnce(new Error('injected stale reap failure'))

    await expect(strategy.deleteByTags(['old-products'])).rejects.toThrow('injected stale reap failure')
    expect(await strategy.get('product')).toBe('fresh')
    expect(await currentRedis.smembers('tag:new-products')).toEqual(['product'])
  })
})

describe('redis strategy concurrent deletion compatibility', () => {
  let strategy: CacheStrategy
  let urlCounter = 0

  beforeEach(() => {
    currentRedis = new FakeRedis()
    urlCounter += 1
    strategy = createRedisStrategy(`redis://cache-deletion-compatibility-${urlCounter}`)
  })

  afterEach(async () => {
    await strategy.close?.()
  })

  function makeExpired(key: string): void {
    const physicalKey = `cache:${key}`
    const entry = JSON.parse(String(currentRedis.values.get(physicalKey)))
    currentRedis.values.set(physicalKey, JSON.stringify({ ...entry, expiresAt: Date.now() - 100 }))
  }

  it('counts an invalidated value found before a concurrent deletion even when DEL returns zero', async () => {
    await strategy.set('race', 'old', { tags: ['products'] })
    const read = currentRedis.getBuffer.bind(currentRedis)
    let removed = false
    currentRedis.getBuffer = async (key) => {
      const snapshot = await read(key)
      if (!removed && key === 'cache:race' && snapshot !== null) {
        removed = true
        currentRedis.expire(key)
      }
      return snapshot
    }
    const remove = jest.spyOn(currentRedis, 'del')

    expect(await strategy.deleteByTags(['products'])).toBe(1)
    expect(removed).toBe(true)
    expect(remove).toHaveReturned()
    expect(await remove.mock.results[0].value).toBe(0)
    expect(currentRedis.values.has('cache:race')).toBe(false)
    expect(await currentRedis.smembers('tag:products')).toEqual([])
  })

  it('counts an expired entry recognized by cleanup even when the deletion read finds it missing', async () => {
    await strategy.set('race', 'old', { tags: ['products'] })
    makeExpired('race')
    const read = currentRedis.getBuffer.bind(currentRedis)
    let removed = false
    currentRedis.getBuffer = async (key) => {
      const snapshot = await read(key)
      if (!removed && key === 'cache:race' && snapshot !== null) {
        removed = true
        currentRedis.expire(key)
      }
      return snapshot
    }

    expect(await strategy.cleanup?.()).toBe(1)
    expect(removed).toBe(true)
    expect(currentRedis.values.has('cache:race')).toBe(false)
    // The previous implementation's second read returns a miss, so it leaves
    // the expired value's membership for the existing orphan reaper.
    expect(await currentRedis.smembers('tag:products')).toEqual(['race'])
    expect(await strategy.deleteByTags(['products'])).toBe(0)
    expect(await currentRedis.smembers('tag:products')).toEqual([])
  })

  it('uses the deletion read tag snapshot after an expired entry is rewritten with new tags', async () => {
    await strategy.set('race', 'old', { tags: ['old-products'] })
    makeExpired('race')
    const read = currentRedis.getBuffer.bind(currentRedis)
    let rewritten = false
    currentRedis.getBuffer = async (key) => {
      const snapshot = await read(key)
      if (!rewritten && key === 'cache:race' && snapshot !== null) {
        rewritten = true
        await strategy.set('race', 'fresh', { tags: ['new-products'] })
      }
      return snapshot
    }

    expect(await strategy.cleanup?.()).toBe(1)
    expect(rewritten).toBe(true)
    // Preserve the previous implementation's behavior: cleanup still deletes
    // the fresh value, but deleteKey reads and removes its current tags.
    expect(currentRedis.values.has('cache:race')).toBe(false)
    expect(await currentRedis.smembers('tag:new-products')).toEqual([])
    // Lazy set retains the old membership; the existing orphan reaper removes
    // it on the next invalidation after cleanup has deleted the current value.
    expect(await currentRedis.smembers('tag:old-products')).toEqual(['race'])
    expect(await strategy.deleteByTags(['old-products'])).toBe(0)
    expect(await currentRedis.smembers('tag:old-products')).toEqual([])
  })

  it('keeps the raw-delete behavior when a corrupt snapshot is rewritten before cleanup deletes it', async () => {
    await strategy.set('race', 'old', { tags: ['old-products'] })
    currentRedis.values.set('cache:race', '{invalid JSON')
    const read = currentRedis.getBuffer.bind(currentRedis)
    let rewritten = false
    currentRedis.getBuffer = async (key) => {
      const snapshot = await read(key)
      if (!rewritten && key === 'cache:race' && snapshot !== null) {
        rewritten = true
        await strategy.set('race', 'fresh', { tags: ['new-products'] })
      }
      return snapshot
    }

    expect(await strategy.cleanup?.()).toBe(1)
    expect(rewritten).toBe(true)
    expect(currentRedis.values.has('cache:race')).toBe(false)
    // A corrupt initial snapshot takes raw DEL, without a second tag read.
    // Repairing these inherited orphan memberships is outside this change.
    expect(await currentRedis.smembers('tag:new-products')).toEqual(['race'])
  })

  it('counts a corrupt cleanup candidate even if it disappears before raw DEL', async () => {
    currentRedis.values.set('cache:race', '{invalid JSON')
    const read = currentRedis.getBuffer.bind(currentRedis)
    let removed = false
    currentRedis.getBuffer = async (key) => {
      const snapshot = await read(key)
      if (!removed && key === 'cache:race' && snapshot !== null) {
        removed = true
        currentRedis.expire(key)
      }
      return snapshot
    }
    const remove = jest.spyOn(currentRedis, 'del')

    expect(await strategy.cleanup?.()).toBe(1)
    expect(removed).toBe(true)
    expect(await remove.mock.results[0].value).toBe(0)
    expect(currentRedis.values.has('cache:race')).toBe(false)
  })

  it('preserves cleanup raw-delete fallback when the second read rejects', async () => {
    await strategy.set('race', 'old', { tags: ['products'] })
    makeExpired('race')
    const read = currentRedis.getBuffer.bind(currentRedis)
    let reads = 0
    currentRedis.getBuffer = async (key) => {
      if (key === 'cache:race' && ++reads === 2) {
        throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value')
      }
      return read(key)
    }

    expect(await strategy.cleanup?.()).toBe(1)
    expect(reads).toBe(2)
    expect(currentRedis.values.has('cache:race')).toBe(false)
    expect(await currentRedis.smembers('tag:products')).toEqual(['race'])
  })
})

describe('redis strategy cursor walks', () => {
  let strategy: CacheStrategy
  let urlCounter = 0

  beforeEach(() => {
    currentRedis = new FakeRedis()
    urlCounter += 1
    strategy = createRedisStrategy(`redis://cache-scan-test-${urlCounter}`)
    // A regression to a blocking KEYS call must fail, even for tiny fixtures.
    jest.spyOn(currentRedis, 'keys').mockRejectedValue(new Error('Use SCAN, not KEYS'))
  })

  afterEach(async () => {
    await strategy.close?.()
  })

  it('continues after an empty page and returns duplicate scan keys only once', async () => {
    currentRedis.scriptedScanPages.set('cache:*', [
      ['17', []],
      ['23', ['cache:alpha', 'cache:beta']],
      ['0', ['cache:beta', 'cache:gamma']],
    ])

    expect(await strategy.keys()).toEqual(['alpha', 'beta', 'gamma'])
    expect(currentRedis.scanCalls.map(({ cursor }) => cursor)).toEqual(['0', '17', '23'])
    expect(currentRedis.scanCalls.every(({ count }) => count > 0)).toBe(true)
  })

  it('walks every page when filtering by a wildcard pattern', async () => {
    for (const key of ['item:a', 'item:b', 'item:c', 'item:d', 'item:e', 'other:x']) {
      await strategy.set(key, key)
    }

    expect(await strategy.keys('item:?')).toEqual(['item:a', 'item:b', 'item:c', 'item:d', 'item:e'])
    expect(currentRedis.scanCalls).toHaveLength(3)
    expect(currentRedis.scanCalls.every(({ pattern }) => pattern === 'cache:item:?')).toBe(true)
  })

  it('counts each scanned entry once in stats, including expired entries', async () => {
    await strategy.set('live', { value: 1 }, { tags: ['shared'] })
    await strategy.set('expired', { value: 2 }, { tags: ['shared'] })
    const stored = JSON.parse(String(currentRedis.values.get('cache:expired')))
    currentRedis.values.set('cache:expired', JSON.stringify({ ...stored, expiresAt: Date.now() - 1 }))
    currentRedis.scriptedScanPages.set('cache:*', [
      ['8', []],
      ['11', ['cache:expired']],
      ['0', ['cache:live', 'cache:expired']],
    ])
    const read = jest.spyOn(currentRedis, 'getBuffer')

    expect(await strategy.stats()).toEqual({ size: 2, expired: 1 })
    expect(read.mock.calls.filter(([key]) => key === 'cache:expired')).toHaveLength(1)
    expect(currentRedis.scanCalls.map(({ cursor }) => cursor)).toEqual(['0', '8', '11'])
  })

  it('cleans expired and corrupt values across pages without losing live tag memberships', async () => {
    await strategy.set('expired', { value: 1 }, { tags: ['shared'] })
    await strategy.set('live', { value: 2 }, { tags: ['shared'] })
    const stored = JSON.parse(String(currentRedis.values.get('cache:expired')))
    currentRedis.values.set('cache:expired', JSON.stringify({ ...stored, expiresAt: Date.now() - 1 }))
    currentRedis.values.set('cache:broken', '{invalid JSON')
    currentRedis.values.set('unrelated:value', 'keep')
    currentRedis.scriptedScanPages.set('cache:*', [
      ['9', []],
      ['21', ['cache:expired', 'cache:broken']],
      ['0', ['cache:live', 'cache:broken']],
    ])
    const read = jest.spyOn(currentRedis, 'getBuffer')

    expect(await strategy.cleanup?.()).toBe(2)
    expect(await strategy.get('live')).toEqual({ value: 2 })
    expect(currentRedis.values.has('cache:expired')).toBe(false)
    expect(currentRedis.values.has('cache:broken')).toBe(false)
    expect(currentRedis.values.get('unrelated:value')).toBe('keep')
    expect(await currentRedis.smembers('tag:shared')).toEqual(['live'])
    expect(read.mock.calls.filter(([key]) => key === 'cache:broken')).toHaveLength(1)
    expect(currentRedis.scanCalls.map(({ cursor }) => cursor)).toEqual(['0', '9', '21'])
  })

  it('clears every cache and tag page, deduplicating keys and preserving other namespaces', async () => {
    for (const key of ['one', 'two', 'three']) {
      await strategy.set(key, key, { tags: [`group-${key}`] })
    }
    currentRedis.values.set('unrelated:value', 'keep')
    currentRedis.sets.set('unrelated:set', new Set(['keep']))
    currentRedis.scriptedScanPages.set('cache:*', [
      ['7', []],
      ['16', ['cache:one', 'cache:two']],
      ['0', ['cache:two', 'cache:three']],
    ])
    currentRedis.scriptedScanPages.set('tag:*', [
      ['2', ['tag:group-one']],
      ['4', []],
      ['0', ['tag:group-two', 'tag:group-three', 'tag:group-one']],
    ])
    const remove = jest.spyOn(currentRedis, 'del')

    expect(await strategy.clear()).toBe(3)
    expect([...currentRedis.values.keys()]).toEqual(['unrelated:value'])
    expect([...currentRedis.sets.keys()]).toEqual(['unrelated:set'])
    expect(remove.mock.calls.flat().filter((key) => key === 'cache:two')).toHaveLength(1)
    expect(remove.mock.calls.flat().filter((key) => key === 'tag:group-one')).toHaveLength(1)
    expect(currentRedis.scanCalls.filter(({ pattern }) => pattern === 'cache:*').map(({ cursor }) => cursor))
      .toEqual(['0', '7', '16'])
    expect(currentRedis.scanCalls.filter(({ pattern }) => pattern === 'tag:*').map(({ cursor }) => cursor))
      .toEqual(['0', '2', '4'])
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

  it('lazily removes old tag memberships without invalidating a compressed overwrite', async () => {
    const strategy = createStrategy('zstd')

    await strategy.set('list', largeValue, { tags: ['old-tag'] })
    await strategy.set('list', largeValue, { tags: ['new-tag'] })

    expect(await currentRedis.smembers('tag:old-tag')).toEqual(['list'])
    expect(await currentRedis.smembers('tag:new-tag')).toEqual(['list'])
    expect(await strategy.deleteByTags(['old-tag'])).toBe(0)
    expect(await strategy.get('list')).toEqual(largeValue)
    expect(await currentRedis.smembers('tag:old-tag')).toEqual([])
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
