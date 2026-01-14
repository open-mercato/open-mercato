import { createMemoryStrategy } from '../strategies/memory'
import type { CacheStrategy } from '../types'

describe('Memory Cache Strategy', () => {
  let cache: CacheStrategy

  beforeEach(() => {
    cache = createMemoryStrategy()
  })

  describe('Basic operations', () => {
    it('should set and get a value', async () => {
      await cache.set('key1', 'value1')
      const value = await cache.get('key1')
      expect(value).toBe('value1')
    })

    it('should return null for non-existent key', async () => {
      const value = await cache.get('nonexistent')
      expect(value).toBeNull()
    })

    it('should store complex objects', async () => {
      const obj = { name: 'John', age: 30, nested: { city: 'NYC' } }
      await cache.set('user', obj)
      const value = await cache.get('user')
      expect(value).toEqual(obj)
    })

    it('should check if key exists', async () => {
      await cache.set('key1', 'value1')
      expect(await cache.has('key1')).toBe(true)
      expect(await cache.has('nonexistent')).toBe(false)
    })

    it('should delete a key', async () => {
      await cache.set('key1', 'value1')
      const deleted = await cache.delete('key1')
      expect(deleted).toBe(true)
      expect(await cache.has('key1')).toBe(false)
      expect(await cache.get('key1')).toBeNull()
    })

    it('should return false when deleting non-existent key', async () => {
      const deleted = await cache.delete('nonexistent')
      expect(deleted).toBe(false)
    })

    it('should overwrite existing key', async () => {
      await cache.set('key1', 'value1')
      await cache.set('key1', 'value2')
      const value = await cache.get('key1')
      expect(value).toBe('value2')
    })
  })

  describe('TTL and expiration', () => {
    beforeEach(() => {
      jest.useFakeTimers()
      jest.setSystemTime(new Date('2025-01-01T00:00:00.000Z'))
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('should expire after TTL', async () => {
      await cache.set('key1', 'value1', { ttl: 100 }) // 100ms
      expect(await cache.get('key1')).toBe('value1')

      await jest.advanceTimersByTimeAsync(150)
      expect(await cache.get('key1')).toBeNull()
      expect(await cache.has('key1')).toBe(false)
    })

    it('should not expire without TTL', async () => {
      await cache.set('key1', 'value1')
      await jest.advanceTimersByTimeAsync(100)
      expect(await cache.get('key1')).toBe('value1')
    })

    it('should return expired value if returnExpired is true', async () => {
      await cache.set('key1', 'value1', { ttl: 50 })
      await jest.advanceTimersByTimeAsync(100)
      const value = await cache.get('key1', { returnExpired: true })
      expect(value).toBe('value1')
    })

    it('should use default TTL when provided', async () => {
      const cacheWithTtl = createMemoryStrategy({ defaultTtl: 100 })
      await cacheWithTtl.set('key1', 'value1') // Should use default TTL
      expect(await cacheWithTtl.get('key1')).toBe('value1')

      await jest.advanceTimersByTimeAsync(150)
      expect(await cacheWithTtl.get('key1')).toBeNull()
    })

    it('should override default TTL with explicit TTL', async () => {
      const cacheWithTtl = createMemoryStrategy({ defaultTtl: 100 })
      await cacheWithTtl.set('key1', 'value1', { ttl: 200 })

      await jest.advanceTimersByTimeAsync(150)
      expect(await cacheWithTtl.get('key1')).toBe('value1') // Still valid

      await jest.advanceTimersByTimeAsync(100)
      expect(await cacheWithTtl.get('key1')).toBeNull() // Now expired
    })
  })

  describe('Tag-based operations', () => {
    it('should set value with tags', async () => {
      await cache.set('user:1', { name: 'John' }, { tags: ['users', 'user:1'] })
      const value = await cache.get('user:1')
      expect(value).toEqual({ name: 'John' })
    })

    it('should delete by single tag', async () => {
      await cache.set('user:1', { name: 'John' }, { tags: ['users'] })
      await cache.set('user:2', { name: 'Jane' }, { tags: ['users'] })
      await cache.set('org:1', { name: 'ACME' }, { tags: ['organizations'] })

      const deleted = await cache.deleteByTags(['users'])
      expect(deleted).toBe(2)
      expect(await cache.get('user:1')).toBeNull()
      expect(await cache.get('user:2')).toBeNull()
      expect(await cache.get('org:1')).toEqual({ name: 'ACME' })
    })

    it('should delete by multiple tags', async () => {
      await cache.set('user:1', { name: 'John' }, { tags: ['users', 'org:1'] })
      await cache.set('user:2', { name: 'Jane' }, { tags: ['users', 'org:2'] })
      await cache.set('org:1', { name: 'ACME' }, { tags: ['organizations', 'org:1'] })

      const deleted = await cache.deleteByTags(['org:1'])
      expect(deleted).toBe(2) // user:1 and org:1
      expect(await cache.get('user:1')).toBeNull()
      expect(await cache.get('org:1')).toBeNull()
      expect(await cache.get('user:2')).toEqual({ name: 'Jane' })
    })

    it('should handle empty tags array', async () => {
      await cache.set('user:1', { name: 'John' }, { tags: ['users'] })
      const deleted = await cache.deleteByTags([])
      expect(deleted).toBe(0)
      expect(await cache.get('user:1')).toEqual({ name: 'John' })
    })

    it('should handle non-existent tags', async () => {
      await cache.set('user:1', { name: 'John' }, { tags: ['users'] })
      const deleted = await cache.deleteByTags(['nonexistent'])
      expect(deleted).toBe(0)
      expect(await cache.get('user:1')).toEqual({ name: 'John' })
    })

    it('should update tags when overwriting key', async () => {
      await cache.set('user:1', { name: 'John' }, { tags: ['users', 'org:1'] })
      await cache.set('user:1', { name: 'John Doe' }, { tags: ['users', 'org:2'] })

      await cache.deleteByTags(['org:1'])
      expect(await cache.get('user:1')).toEqual({ name: 'John Doe' }) // Should still exist

      await cache.deleteByTags(['org:2'])
      expect(await cache.get('user:1')).toBeNull() // Now deleted
    })
  })

  describe('Pattern matching', () => {
    beforeEach(async () => {
      await cache.set('user:1', 'John')
      await cache.set('user:2', 'Jane')
      await cache.set('org:1', 'ACME')
      await cache.set('product:1', 'Widget')
    })

    it('should return all keys without pattern', async () => {
      const keys = await cache.keys()
      expect(keys).toHaveLength(4)
      expect(keys).toContain('user:1')
      expect(keys).toContain('user:2')
      expect(keys).toContain('org:1')
      expect(keys).toContain('product:1')
    })

    it('should match keys with wildcard', async () => {
      const keys = await cache.keys('user:*')
      expect(keys).toHaveLength(2)
      expect(keys).toContain('user:1')
      expect(keys).toContain('user:2')
    })

    it('should match keys with question mark', async () => {
      const keys = await cache.keys('user:?')
      expect(keys).toHaveLength(2)
      expect(keys).toContain('user:1')
      expect(keys).toContain('user:2')
    })

    it('should match exact key', async () => {
      const keys = await cache.keys('org:1')
      expect(keys).toHaveLength(1)
      expect(keys).toContain('org:1')
    })

    it('should return empty array for no matches', async () => {
      const keys = await cache.keys('nonexistent:*')
      expect(keys).toHaveLength(0)
    })
  })

  describe('Clear and cleanup', () => {
    it('should clear all cache entries', async () => {
      await cache.set('key1', 'value1')
      await cache.set('key2', 'value2')
      await cache.set('key3', 'value3')

      const cleared = await cache.clear()
      expect(cleared).toBe(3)
      expect(await cache.keys()).toHaveLength(0)
    })

    it('should cleanup expired entries', async () => {
      await cache.set('key1', 'value1', { ttl: 50 })
      await cache.set('key2', 'value2', { ttl: 50 })
      await cache.set('key3', 'value3') // No TTL

      await new Promise((resolve) => setTimeout(resolve, 100))

      const removed = await cache.cleanup!()
      expect(removed).toBe(2)
      expect(await cache.get('key1')).toBeNull()
      expect(await cache.get('key2')).toBeNull()
      expect(await cache.get('key3')).toBe('value3')
    })
  })

  describe('Statistics', () => {
    it('should return correct statistics', async () => {
      await cache.set('key1', 'value1')
      await cache.set('key2', 'value2')
      await cache.set('key3', 'value3', { ttl: 50 })

      let stats = await cache.stats()
      expect(stats.size).toBe(3)
      expect(stats.expired).toBe(0)

      await new Promise((resolve) => setTimeout(resolve, 100))

      stats = await cache.stats()
      expect(stats.size).toBe(3)
      expect(stats.expired).toBe(1)
    })
  })
})
