import type { CacheStrategy, CacheServiceOptions, CacheGetOptions, CacheSetOptions } from './types'
import { createMemoryStrategy } from './strategies/memory'
import { createRedisStrategy } from './strategies/redis'
import { createSqliteStrategy } from './strategies/sqlite'
import { createJsonFileStrategy } from './strategies/jsonfile'

/**
 * Cache service that provides a unified interface to different cache strategies
 * 
 * Configuration via environment variables:
 * - CACHE_STRATEGY: 'memory' | 'redis' | 'sqlite' | 'jsonfile' (default: 'memory')
 * - CACHE_TTL: Default TTL in milliseconds (optional)
 * - CACHE_REDIS_URL: Redis connection URL (for redis strategy)
 * - CACHE_SQLITE_PATH: SQLite database file path (for sqlite strategy)
 * - CACHE_JSON_FILE_PATH: JSON file path (for jsonfile strategy)
 * 
 * @example
 * const cache = createCacheService({ strategy: 'memory', defaultTtl: 60000 })
 * await cache.set('user:123', { name: 'John' }, { tags: ['users', 'user:123'] })
 * const user = await cache.get('user:123')
 * await cache.deleteByTags(['users']) // Invalidate all user-related cache
 */
export function createCacheService(options?: CacheServiceOptions): CacheStrategy {
  const strategyType = options?.strategy 
    || (process.env.CACHE_STRATEGY as any) 
    || 'memory'

  const defaultTtl = options?.defaultTtl 
    || (process.env.CACHE_TTL ? parseInt(process.env.CACHE_TTL, 10) : undefined)

  let strategy: CacheStrategy

  switch (strategyType) {
    case 'redis':
      strategy = createRedisStrategy(options?.redisUrl, { defaultTtl })
      break

    case 'sqlite':
      strategy = createSqliteStrategy(options?.sqlitePath, { defaultTtl })
      break

    case 'jsonfile':
      strategy = createJsonFileStrategy(options?.jsonFilePath, { defaultTtl })
      break

    case 'memory':
    default:
      strategy = createMemoryStrategy({ defaultTtl })
      break
  }

  return strategy
}

/**
 * CacheService class wrapper for DI integration
 * Provides the same interface as the functional API but as a class
 */
export class CacheService implements CacheStrategy {
  private strategy: CacheStrategy

  constructor(options?: CacheServiceOptions) {
    this.strategy = createCacheService(options)
  }

  async get(key: string, options?: CacheGetOptions): Promise<any | null> {
    return this.strategy.get(key, options)
  }

  async set(key: string, value: any, options?: CacheSetOptions): Promise<void> {
    return this.strategy.set(key, value, options)
  }

  async has(key: string): Promise<boolean> {
    return this.strategy.has(key)
  }

  async delete(key: string): Promise<boolean> {
    return this.strategy.delete(key)
  }

  async deleteByTags(tags: string[]): Promise<number> {
    return this.strategy.deleteByTags(tags)
  }

  async clear(): Promise<number> {
    return this.strategy.clear()
  }

  async keys(pattern?: string): Promise<string[]> {
    return this.strategy.keys(pattern)
  }

  async stats(): Promise<{ size: number; expired: number }> {
    return this.strategy.stats()
  }

  async cleanup(): Promise<number> {
    if (this.strategy.cleanup) {
      return this.strategy.cleanup()
    }
    return 0
  }

  async close(): Promise<void> {
    if (this.strategy.close) {
      return this.strategy.close()
    }
  }
}

