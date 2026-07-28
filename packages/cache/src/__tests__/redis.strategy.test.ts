/** @jest-environment node */
import type { CacheStrategy } from '../types'
import { createRedisStrategy } from '../strategies/redis'

type PipelineOp = () => void

class FakeRedis {
  values = new Map<string, string>()
  sets = new Map<string, Set<string>>()

  async ping(): Promise<string> {
    return 'PONG'
  }

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null
  }

  async set(key: string, value: string): Promise<unknown> {
    this.values.set(key, value)
    return 'OK'
  }

  async setex(key: string, _ttlSeconds: number, value: string): Promise<unknown> {
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

  pipeline() {
    const ops: PipelineOp[] = []
    const chain = {
      set: (key: string, value: string) => {
        ops.push(() => void this.values.set(key, value))
        return chain
      },
      setex: (key: string, _ttlSeconds: number, value: string) => {
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

jest.mock('ioredis', () => ({
  __esModule: true,
  default: class {
    constructor() {
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

  it('only reaps orphans from the tags it was asked to invalidate', async () => {
    await strategy.set('key-1', { value: 1 }, { ttl: 60_000, tags: ['tag-a', 'tag-b'] })
    currentRedis.expire('cache:key-1')

    await strategy.deleteByTags(['tag-a'])

    expect(await currentRedis.smembers('tag:tag-a')).toEqual([])
    expect(await currentRedis.smembers('tag:tag-b')).toEqual(['key-1'])
  })
})
