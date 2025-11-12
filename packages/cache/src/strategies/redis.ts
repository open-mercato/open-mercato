import type { CacheStrategy, CacheEntry, CacheGetOptions, CacheSetOptions, CacheValue } from '../types'
import { CacheDependencyUnavailableError } from '../errors'

type RedisPipeline = {
  set(key: string, value: string): RedisPipeline
  setex(key: string, ttlSeconds: number, value: string): RedisPipeline
  sadd(key: string, value: string): RedisPipeline
  srem(key: string, member: string): RedisPipeline
  del(key: string): RedisPipeline
  exec(): Promise<unknown>
}

type RedisClient = {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<unknown>
  setex(key: string, ttlSeconds: number, value: string): Promise<unknown>
  del(key: string): Promise<unknown>
  keys(pattern: string): Promise<string[]>
  smembers(key: string): Promise<string[]>
  pipeline(): RedisPipeline
  quit(): Promise<void>
}

type RedisConstructor = new (url?: string) => RedisClient
type RedisModule = RedisConstructor | { default: RedisConstructor }

/**
 * Redis cache strategy with tag support
 * Persistent across process restarts, can be shared across multiple instances
 * 
 * Uses Redis data structures:
 * - Hash for storing cache entries: cache:{key} -> {value, tags, expiresAt, createdAt}
 * - Sets for tag index: tag:{tag} -> Set of keys
 */
export function createRedisStrategy(redisUrl?: string, options?: { defaultTtl?: number }): CacheStrategy {
  let redis: RedisClient | null = null
  const defaultTtl = options?.defaultTtl
  const keyPrefix = 'cache:'
  const tagPrefix = 'tag:'

  async function getRedisClient(): Promise<RedisClient> {
    if (redis) return redis

    try {
      const imported = await import('ioredis') as RedisModule
      const Redis = typeof imported === 'function' ? imported : imported.default
      redis = new Redis(redisUrl || process.env.REDIS_URL || process.env.CACHE_REDIS_URL || 'redis://localhost:6379')
      return redis
    } catch (error) {
      throw new CacheDependencyUnavailableError('redis', 'ioredis', error)
    }
  }

  function getCacheKey(key: string): string {
    return `${keyPrefix}${key}`
  }

  function getTagKey(tag: string): string {
    return `${tagPrefix}${tag}`
  }

  function isExpired(entry: CacheEntry): boolean {
    if (entry.expiresAt === null) return false
    return Date.now() > entry.expiresAt
  }

  function matchPattern(key: string, pattern: string): boolean {
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
    const regex = new RegExp(`^${regexPattern}$`)
    return regex.test(key)
  }

  const get = async (key: string, options?: CacheGetOptions): Promise<CacheValue | null> => {
    const client = await getRedisClient()
    const cacheKey = getCacheKey(key)
    const data = await client.get(cacheKey)

    if (!data) return null

    try {
      const entry: CacheEntry = JSON.parse(data)

      if (isExpired(entry)) {
        if (options?.returnExpired) {
          return entry.value
        }
        // Clean up expired entry
        await deleteKey(key)
        return null
      }

      return entry.value
    } catch {
      // Invalid JSON, remove it
      await client.del(cacheKey)
      return null
    }
  }

  const set = async (key: string, value: CacheValue, options?: CacheSetOptions): Promise<void> => {
    const client = await getRedisClient()
    const cacheKey = getCacheKey(key)

    // Remove old entry from tag index if it exists
    const oldData = await client.get(cacheKey)
    if (oldData) {
      try {
        const oldEntry: CacheEntry = JSON.parse(oldData)
        // Remove from old tags
        const pipeline = client.pipeline()
        for (const tag of oldEntry.tags) {
          pipeline.srem(getTagKey(tag), key)
        }
        await pipeline.exec()
      } catch {
        // Ignore parse errors
      }
    }

    const ttl = options?.ttl ?? defaultTtl
    const tags = options?.tags || []
    const expiresAt = ttl ? Date.now() + ttl : null

    const entry: CacheEntry = {
      key,
      value,
      tags,
      expiresAt,
      createdAt: Date.now(),
    }

    const pipeline = client.pipeline()

    // Store the entry
    const serialized = JSON.stringify(entry)
    if (ttl) {
      pipeline.setex(cacheKey, Math.ceil(ttl / 1000), serialized)
    } else {
      pipeline.set(cacheKey, serialized)
    }

    // Add to tag index
    for (const tag of tags) {
      pipeline.sadd(getTagKey(tag), key)
    }

    await pipeline.exec()
  }

  const has = async (key: string): Promise<boolean> => {
    const client = await getRedisClient()
    const cacheKey = getCacheKey(key)
    const exists = await client.exists(cacheKey)

    if (!exists) return false

    // Check if expired
    const data = await client.get(cacheKey)
    if (!data) return false

    try {
      const entry: CacheEntry = JSON.parse(data)
      if (isExpired(entry)) {
        await deleteKey(key)
        return false
      }
      return true
    } catch {
      return false
    }
  }

  const deleteKey = async (key: string): Promise<boolean> => {
    const client = await getRedisClient()
    const cacheKey = getCacheKey(key)

    // Get entry to remove from tag index
    const data = await client.get(cacheKey)
    if (!data) return false

    try {
      const entry: CacheEntry = JSON.parse(data)
      const pipeline = client.pipeline()

      // Remove from tag index
      for (const tag of entry.tags) {
        pipeline.srem(getTagKey(tag), key)
      }

      // Delete the cache entry
      pipeline.del(cacheKey)

      await pipeline.exec()
      return true
    } catch {
      // Just delete the key if we can't parse it
      await client.del(cacheKey)
      return true
    }
  }

  const deleteByTags = async (tags: string[]): Promise<number> => {
    const client = await getRedisClient()
    const keysToDelete = new Set<string>()

    // Collect all keys that have any of the specified tags
    for (const tag of tags) {
      const tagKey = getTagKey(tag)
      const keys = await client.smembers(tagKey)
      for (const key of keys) {
        keysToDelete.add(key)
      }
    }

    // Delete all collected keys
    let deleted = 0
    for (const key of keysToDelete) {
      const success = await deleteKey(key)
      if (success) deleted++
    }

    return deleted
  }

  const clear = async (): Promise<number> => {
    const client = await getRedisClient()
    
    // Get all cache keys
    const cacheKeys = await client.keys(`${keyPrefix}*`)
    const tagKeys = await client.keys(`${tagPrefix}*`)

    if (cacheKeys.length === 0 && tagKeys.length === 0) return 0

    const pipeline = client.pipeline()
    for (const key of [...cacheKeys, ...tagKeys]) {
      pipeline.del(key)
    }

    await pipeline.exec()
    return cacheKeys.length
  }

  const keys = async (pattern?: string): Promise<string[]> => {
    const client = await getRedisClient()
    const searchPattern = pattern 
      ? `${keyPrefix}${pattern}` 
      : `${keyPrefix}*`
    
    const cacheKeys = await client.keys(searchPattern)
    
    // Remove prefix from keys
    const result = cacheKeys.map((key: string) => key.substring(keyPrefix.length))
    
    if (!pattern) return result
    
    // Apply pattern matching (Redis KEYS command uses glob pattern, but we want our pattern)
    return result.filter((key: string) => matchPattern(key, pattern))
  }

  const stats = async (): Promise<{ size: number; expired: number }> => {
    const client = await getRedisClient()
    const cacheKeys = await client.keys(`${keyPrefix}*`)
    
    let expired = 0
    for (const cacheKey of cacheKeys) {
      const data = await client.get(cacheKey)
      if (data) {
        try {
          const entry: CacheEntry = JSON.parse(data)
          if (isExpired(entry)) {
            expired++
          }
        } catch {
          // Ignore parse errors
        }
      }
    }

    return { size: cacheKeys.length, expired }
  }

  const cleanup = async (): Promise<number> => {
    const client = await getRedisClient()
    const cacheKeys = await client.keys(`${keyPrefix}*`)
    
    let removed = 0
    for (const cacheKey of cacheKeys) {
      const data = await client.get(cacheKey)
      if (data) {
        try {
          const entry: CacheEntry = JSON.parse(data)
          if (isExpired(entry)) {
            const key = cacheKey.substring(keyPrefix.length)
            await deleteKey(key)
            removed++
          }
        } catch {
          // Remove invalid entries
          await client.del(cacheKey)
          removed++
        }
      }
    }

    return removed
  }

  const close = async (): Promise<void> => {
    if (redis) {
      await redis.quit()
      redis = null
    }
  }

  return {
    get,
    set,
    has,
    delete: deleteKey,
    deleteByTags,
    clear,
    keys,
    stats,
    cleanup,
    close,
  }
}
