import { createCacheService, CacheService } from '../service'

describe('Cache Service', () => {
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
      const removed = await cache.cleanup()
      expect(removed).toBe(50)
      
      stats = await cache.stats()
      expect(stats.size).toBe(10)
      expect(stats.expired).toBe(0)
    })
  })
})

