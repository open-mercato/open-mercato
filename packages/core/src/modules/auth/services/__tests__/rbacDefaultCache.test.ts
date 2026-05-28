import {
  createRbacFallbackCache,
  isRbacDefaultCacheEnabled,
  resetRbacFallbackCache,
} from '../rbacDefaultCache'

describe('rbacDefaultCache', () => {
  const originalToggle = process.env.OM_RBAC_DEFAULT_CACHE

  beforeEach(() => {
    delete process.env.OM_RBAC_DEFAULT_CACHE
    resetRbacFallbackCache()
  })

  afterEach(() => {
    if (originalToggle === undefined) delete process.env.OM_RBAC_DEFAULT_CACHE
    else process.env.OM_RBAC_DEFAULT_CACHE = originalToggle
    resetRbacFallbackCache()
  })

  it('isRbacDefaultCacheEnabled defaults to OFF and turns on for explicit opt-in tokens', () => {
    // Default OFF — matches develop's posture so opting in is deliberate.
    expect(isRbacDefaultCacheEnabled()).toBe(false)
    for (const token of ['on', '1', 'true', 'yes', 'ON', 'True']) {
      process.env.OM_RBAC_DEFAULT_CACHE = token
      expect(isRbacDefaultCacheEnabled()).toBe(true)
    }
    for (const token of ['off', '0', 'false', '', 'no', 'maybe']) {
      process.env.OM_RBAC_DEFAULT_CACHE = token
      expect(isRbacDefaultCacheEnabled()).toBe(false)
    }
  })

  it('returns the same process-scoped instance across calls', () => {
    const a = createRbacFallbackCache()
    const b = createRbacFallbackCache()
    expect(a).toBe(b)
  })

  it('get/set round-trip preserves value and honors TTL', async () => {
    const cache = createRbacFallbackCache()
    await cache.set('user:1', { features: ['*'] }, { ttl: 60_000 })
    expect(await cache.get('user:1')).toEqual({ features: ['*'] })
    expect(await cache.get('user:missing')).toBeNull()
  })

  it('deleteByTags removes all entries with matching tag', async () => {
    const cache = createRbacFallbackCache()
    await cache.set('user:1', { features: ['*'] }, { ttl: 60_000, tags: ['rbac:tenant:t1', 'rbac:user:u1'] })
    await cache.set('user:2', { features: [] }, { ttl: 60_000, tags: ['rbac:tenant:t1', 'rbac:user:u2'] })
    await cache.set('user:3', { features: [] }, { ttl: 60_000, tags: ['rbac:tenant:t2'] })
    const removed = await cache.deleteByTags(['rbac:tenant:t1'])
    expect(removed).toBe(2)
    expect(await cache.get('user:1')).toBeNull()
    expect(await cache.get('user:2')).toBeNull()
    expect(await cache.get('user:3')).not.toBeNull()
  })

  it('expired entries are evicted on read', async () => {
    const cache = createRbacFallbackCache()
    await cache.set('user:1', 'value', { ttl: 1 })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(await cache.get('user:1')).toBeNull()
  })

  it('clear empties the store', async () => {
    const cache = createRbacFallbackCache()
    await cache.set('a', 1, { ttl: 60_000 })
    await cache.set('b', 2, { ttl: 60_000 })
    expect(await cache.clear()).toBe(2)
    expect(await cache.size()).toBe(0)
  })
})
