/** @jest-environment node */

import type { CacheStrategy } from '@open-mercato/cache'
import { checkRateLimit, __resetRateLimiterFallback } from '../rateLimiter'

const config = { maxPerMinute: 3, maxPerHour: 100, maxPerDay: 1000 }

function makeMemoryCache(): CacheStrategy {
  const store = new Map<string, unknown>()
  return {
    get: jest.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: jest.fn(async (key: string, value: unknown) => {
      store.set(key, value)
    }),
    has: jest.fn(async (key: string) => store.has(key)),
    delete: jest.fn(async (key: string) => store.delete(key)),
    deleteByTags: jest.fn(async () => 0),
    clear: jest.fn(async () => {
      const size = store.size
      store.clear()
      return size
    }),
    keys: jest.fn(async () => Array.from(store.keys())),
    stats: jest.fn(async () => ({ size: store.size, expired: 0 })),
  } as unknown as CacheStrategy
}

describe('checkRateLimit', () => {
  beforeEach(() => {
    __resetRateLimiterFallback()
  })

  it('allows requests under the limit and blocks once exceeded (cache-backed)', async () => {
    const cache = makeMemoryCache()
    expect((await checkRateLimit(cache, 'k', undefined, config)).allowed).toBe(true)
    expect((await checkRateLimit(cache, 'k', undefined, config)).allowed).toBe(true)
    expect((await checkRateLimit(cache, 'k', undefined, config)).allowed).toBe(true)

    const blocked = await checkRateLimit(cache, 'k', undefined, config)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('fails CLOSED when no cache is available (process-local fallback)', async () => {
    expect((await checkRateLimit(null, 'no-cache', undefined, config)).allowed).toBe(true)
    expect((await checkRateLimit(null, 'no-cache', undefined, config)).allowed).toBe(true)
    expect((await checkRateLimit(null, 'no-cache', undefined, config)).allowed).toBe(true)

    // Without a cache the limiter must NOT wave everything through.
    const blocked = await checkRateLimit(null, 'no-cache', undefined, config)
    expect(blocked.allowed).toBe(false)
  })

  it('fails CLOSED when the cache throws (does not bypass throttling)', async () => {
    const erroringCache = {
      get: jest.fn(async () => {
        throw new Error('cache down')
      }),
      set: jest.fn(async () => {
        throw new Error('cache down')
      }),
    } as unknown as CacheStrategy

    expect((await checkRateLimit(erroringCache, 'err', undefined, config)).allowed).toBe(true)
    expect((await checkRateLimit(erroringCache, 'err', undefined, config)).allowed).toBe(true)
    expect((await checkRateLimit(erroringCache, 'err', undefined, config)).allowed).toBe(true)

    const blocked = await checkRateLimit(erroringCache, 'err', undefined, config)
    expect(blocked.allowed).toBe(false)
  })

  it('isolates buckets per key so one key cannot dilute another', async () => {
    const cache = makeMemoryCache()
    for (let i = 0; i < config.maxPerMinute; i += 1) {
      await checkRateLimit(cache, 'tenant-a', undefined, config)
    }
    // tenant-a is now exhausted, tenant-b should still be allowed.
    expect((await checkRateLimit(cache, 'tenant-a', undefined, config)).allowed).toBe(false)
    expect((await checkRateLimit(cache, 'tenant-b', undefined, config)).allowed).toBe(true)
  })
})
