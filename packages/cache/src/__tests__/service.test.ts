import { createCacheService, CacheService } from '../service'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_JSON_FILE_CACHE_PATH, DEFAULT_SQLITE_CACHE_PATH } from '../defaults'
import type { CacheStrategy } from '../types'
import * as memoryStrategyModule from '../strategies/memory'
import * as sqliteStrategyModule from '../strategies/sqlite'

describe('Cache Service', () => {
  afterEach(() => {
    delete process.env.CACHE_SQLITE_PATH
    fs.rmSync(path.resolve('.mercato/cache'), { recursive: true, force: true })
  })

  describe('Strategy selection', () => {
    it('should default to memory strategy', async () => {
      const cache = createCacheService()
      await cache.set('test', 'value')
      const value = await cache.get('test')
      expect(value).toBe('value')
    })

    it('should use memory strategy when specified', async () => {
      const cache = createCacheService({ strategy: 'memory' })
      await cache.set('test', 'value')
      const value = await cache.get('test')
      expect(value).toBe('value')
    })

    it('should use jsonfile strategy when specified', async () => {
      const cache = createCacheService({ 
        strategy: 'jsonfile',
        jsonFilePath: '.test-cache.json'
      })
      
      await cache.set('test', 'value')
      const value = await cache.get('test')
      expect(value).toBe('value')
      
      await cache.clear()
    })

    it('should respect defaultTtl option', async () => {
      const cache = createCacheService({ 
        strategy: 'memory',
        defaultTtl: 100
      })
      
      await cache.set('test', 'value') // Should use default TTL
      expect(await cache.get('test')).toBe('value')
      
      await new Promise((resolve) => setTimeout(resolve, 150))
      expect(await cache.get('test')).toBeNull()
    })

    it('should keep file-backed cache defaults under .mercato', async () => {
      expect(DEFAULT_SQLITE_CACHE_PATH).toBe('.mercato/cache/cache.db')
      expect(DEFAULT_JSON_FILE_CACHE_PATH).toBe('.mercato/cache/cache.json')
    })
  })

  describe('CacheService class', () => {
    let cache: CacheService

    beforeEach(() => {
      cache = new CacheService({ strategy: 'memory' })
    })

    it('should set and get values', async () => {
      await cache.set('key', 'value')
      const value = await cache.get('key')
      expect(value).toBe('value')
    })

    it('should support tags', async () => {
      await cache.set('user:1', { name: 'John' }, { tags: ['users'] })
      await cache.set('user:2', { name: 'Jane' }, { tags: ['users'] })
      
      const deleted = await cache.deleteByTags(['users'])
      expect(deleted).toBe(2)
    })

    it('should support all cache operations', async () => {
      await cache.set('key1', 'value1')
      await cache.set('key2', 'value2')
      
      expect(await cache.has('key1')).toBe(true)
      expect(await cache.has('nonexistent')).toBe(false)
      
      const keys = await cache.keys()
      expect(keys).toHaveLength(2)
      
      const stats = await cache.stats()
      expect(stats.size).toBe(2)
      
      const deleted = await cache.delete('key1')
      expect(deleted).toBe(true)
      
      const cleared = await cache.clear()
      expect(cleared).toBe(1)
    })

    it('should support cleanup', async () => {
      await cache.set('key1', 'value1', { ttl: 50 })
      await new Promise((resolve) => setTimeout(resolve, 100))
      
      const removed = await cache.cleanup()
      expect(removed).toBeGreaterThanOrEqual(0)
    })

    it('should support close', async () => {
      await cache.close()
      // Should not throw
    })
  })

  describe('Complex scenarios', () => {
    it('should handle concurrent operations', async () => {
      const cache = createCacheService()
      
      const promises = []
      for (let i = 0; i < 100; i++) {
        promises.push(cache.set(`key${i}`, `value${i}`))
      }
      await Promise.all(promises)
      
      const stats = await cache.stats()
      expect(stats.size).toBe(100)
      
      const getPromises = []
      for (let i = 0; i < 100; i++) {
        getPromises.push(cache.get(`key${i}`))
      }
      const values = await Promise.all(getPromises)
      
      values.forEach((value, i) => {
        expect(value).toBe(`value${i}`)
      })
    })

    it('should handle tag-based invalidation with complex tag structure', async () => {
      const cache = createCacheService()
      
      // User cache entries with multiple tags
      await cache.set('user:1:profile', { name: 'John' }, { 
        tags: ['users', 'user:1', 'profiles', 'org:1'] 
      })
      await cache.set('user:1:settings', { theme: 'dark' }, { 
        tags: ['users', 'user:1', 'settings', 'org:1'] 
      })
      await cache.set('user:2:profile', { name: 'Jane' }, { 
        tags: ['users', 'user:2', 'profiles', 'org:1'] 
      })
      await cache.set('user:3:profile', { name: 'Bob' }, { 
        tags: ['users', 'user:3', 'profiles', 'org:2'] 
      })
      
      // Invalidate all user:1 cache
      const deleted = await cache.deleteByTags(['user:1'])
      expect(deleted).toBe(2)
      expect(await cache.get('user:1:profile')).toBeNull()
      expect(await cache.get('user:1:settings')).toBeNull()
      expect(await cache.get('user:2:profile')).not.toBeNull()
      
      // Invalidate all org:1 cache
      const deleted2 = await cache.deleteByTags(['org:1'])
      expect(deleted2).toBe(1) // Only user:2:profile remains
      expect(await cache.get('user:2:profile')).toBeNull()
      expect(await cache.get('user:3:profile')).not.toBeNull()
    })

    it('should handle rapid TTL expirations', async () => {
      const cache = createCacheService()
      
      // Create many entries with short TTL
      for (let i = 0; i < 50; i++) {
        await cache.set(`temp:${i}`, `value${i}`, { ttl: 50 })
      }
      
      // Create some permanent entries
      for (let i = 0; i < 10; i++) {
        await cache.set(`perm:${i}`, `value${i}`)
      }
      
      let stats = await cache.stats()
      expect(stats.size).toBe(60)
      
      await new Promise((resolve) => setTimeout(resolve, 100))
      
      stats = await cache.stats()
      expect(stats.expired).toBe(50)
      
      // Cleanup should remove expired entries
      if (!cache.cleanup) {
        throw new Error('Expected cache strategy to support cleanup in tests')
      }
      const removed = await cache.cleanup()
      expect(removed).toBe(50)
      
      stats = await cache.stats()
      expect(stats.size).toBe(10)
      expect(stats.expired).toBe(0)
    })
  })

  describe('Memory bound env resolution (CACHE_MEMORY_MAX_ENTRIES)', () => {
    afterEach(() => {
      delete process.env.CACHE_MEMORY_MAX_ENTRIES
    })

    it('bounds a memory-backed service when the env var is set', async () => {
      process.env.CACHE_MEMORY_MAX_ENTRIES = '10'
      const cache = createCacheService({ strategy: 'memory' })

      for (let index = 0; index < 30; index += 1) {
        await cache.set(`key:${index}`, index)
      }

      const stats = await cache.stats()
      // The LRU cap kept the store far below the 30 logical writes and the
      // surfaced eviction counter proves the bound was actively enforced.
      expect(stats.size).toBeLessThan(30)
      expect(stats.evictions).toBeGreaterThan(0)
    })

    it('ignores an invalid env value and stays unbounded by default', async () => {
      process.env.CACHE_MEMORY_MAX_ENTRIES = 'not-a-number'
      const cache = createCacheService({ strategy: 'memory' })

      for (let index = 0; index < 30; index += 1) {
        await cache.set(`key:${index}`, index)
      }

      const stats = await cache.stats()
      // Invalid value parses to NaN, is discarded, and the default cap (50k)
      // leaves all 30 entries resident with no evictions.
      expect(stats.size).toBe(30)
      expect(stats.evictions).toBe(0)
    })
  })
})

describe('Cache Service stats() counter gating', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  const createFakeStrategy = (stats: CacheStrategy['stats']): CacheStrategy => ({
    get: jest.fn(async () => null),
    set: jest.fn(async () => {}),
    has: jest.fn(async () => false),
    delete: jest.fn(async () => false),
    deleteByTags: jest.fn(async () => 0),
    clear: jest.fn(async () => 0),
    keys: jest.fn(async () => []),
    stats,
  })

  it('skips the extra base.stats() call for non-memory backends', async () => {
    const baseStats = jest.fn(async () => ({ size: 5, expired: 1 }))
    jest
      .spyOn(sqliteStrategyModule, 'createSqliteStrategy')
      .mockReturnValue(createFakeStrategy(baseStats))

    const cache = createCacheService({ strategy: 'sqlite' })
    const stats = await cache.stats()

    // The cold-path counter harvest is gated to memory-backed strategies, so a
    // redis/sqlite/jsonfile backend never incurs the extra base.stats() round-trip.
    expect(baseStats).not.toHaveBeenCalled()
    expect(stats).toEqual({ size: 0, expired: 0 })
    expect(stats.evictions).toBeUndefined()
    expect(stats.sweeps).toBeUndefined()
    expect(stats.lastSweepReclaimed).toBeUndefined()
  })

  it('still harvests bound counters via base.stats() for the memory backend', async () => {
    const baseStats = jest.fn(async () => ({
      size: 99,
      expired: 99,
      evictions: 7,
      sweeps: 2,
      lastSweepReclaimed: 3,
    }))
    jest
      .spyOn(memoryStrategyModule, 'createMemoryStrategy')
      .mockReturnValue(createFakeStrategy(baseStats))

    const cache = createCacheService({ strategy: 'memory' })
    const stats = await cache.stats()

    // size/expired stay tenant-scoped (computed by the wrapper), while the
    // process-global counters come from a single base.stats() call.
    expect(baseStats).toHaveBeenCalledTimes(1)
    expect(stats.size).toBe(0)
    expect(stats.expired).toBe(0)
    expect(stats.evictions).toBe(7)
    expect(stats.sweeps).toBe(2)
    expect(stats.lastSweepReclaimed).toBe(3)
  })
})
