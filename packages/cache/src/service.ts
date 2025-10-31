import type { CacheStrategy, CacheServiceOptions, CacheGetOptions, CacheSetOptions } from './types'
import { createMemoryStrategy } from './strategies/memory'
import { createRedisStrategy } from './strategies/redis'
import { createSqliteStrategy } from './strategies/sqlite'
import { createJsonFileStrategy } from './strategies/jsonfile'
import { getCurrentCacheTenant } from './tenantContext'

function normalizeTenantKey(raw: string | null | undefined): string {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) return 'global'
  return value.replace(/[^a-zA-Z0-9._-]/g, '_')
}

type TenantPrefixes = {
  keyPrefix: string
  tagPrefix: string
  scopeTag: string
}

function resolveTenantPrefixes(): TenantPrefixes {
  const tenant = normalizeTenantKey(getCurrentCacheTenant())
  const base = `tenant:${tenant}:`
  return {
    keyPrefix: `${base}key:`,
    tagPrefix: `${base}tag:`,
    scopeTag: `${base}tag:__scope__`,
  }
}

function prefixKey(key: string, prefixes: TenantPrefixes): string {
  return `${prefixes.keyPrefix}${key}`
}

function prefixTag(tag: string, prefixes: TenantPrefixes): string {
  return `${prefixes.tagPrefix}${tag}`
}

function includeScopeTag(tags: string[] | undefined, prefixes: TenantPrefixes): string[] {
  const scoped = new Set<string>()
  scoped.add(prefixes.scopeTag)
  if (Array.isArray(tags)) {
    for (const tag of tags) {
      if (typeof tag === 'string' && tag.length > 0) scoped.add(prefixTag(tag, prefixes))
    }
  }
  return Array.from(scoped)
}

function stripKeyPrefix(key: string, prefixes: TenantPrefixes): string | null {
  if (!key.startsWith(prefixes.keyPrefix)) return null
  return key.slice(prefixes.keyPrefix.length)
}

function createTenantAwareWrapper(base: CacheStrategy): CacheStrategy {
  const get = async (key: string, options?: CacheGetOptions) => {
    const prefixes = resolveTenantPrefixes()
    return base.get(prefixKey(key, prefixes), options)
  }

  const set = async (key: string, value: any, options?: CacheSetOptions) => {
    const prefixes = resolveTenantPrefixes()
    const nextOptions: CacheSetOptions | undefined = options
      ? { ...options, tags: includeScopeTag(options.tags, prefixes) }
      : { tags: includeScopeTag(undefined, prefixes) }
    return base.set(prefixKey(key, prefixes), value, nextOptions)
  }

  const has = async (key: string) => {
    const prefixes = resolveTenantPrefixes()
    return base.has(prefixKey(key, prefixes))
  }

  const del = async (key: string) => {
    const prefixes = resolveTenantPrefixes()
    return base.delete(prefixKey(key, prefixes))
  }

  const deleteByTags = async (tags: string[]) => {
    const prefixes = resolveTenantPrefixes()
    const scopedTags = tags.map((tag) => prefixTag(tag, prefixes))
    return base.deleteByTags(scopedTags)
  }

  const clear = async () => {
    const prefixes = resolveTenantPrefixes()
    return base.deleteByTags([prefixes.scopeTag])
  }

  const keys = async (pattern?: string) => {
    const prefixes = resolveTenantPrefixes()
    const searchPattern = prefixKey(pattern ?? '*', prefixes)
    const scopedKeys = await base.keys(searchPattern)
    const result: string[] = []
    for (const key of scopedKeys) {
      const unwrapped = stripKeyPrefix(key, prefixes)
      if (unwrapped !== null) {
        result.push(unwrapped)
      }
    }
    return result
  }

  const stats = async () => {
    const prefixes = resolveTenantPrefixes()
    const scopedKeys = await base.keys(prefixKey('*', prefixes))
    return { size: scopedKeys.length, expired: 0 }
  }

  const cleanup = base.cleanup
    ? async () => base.cleanup!()
    : undefined

  const close = base.close
    ? async () => base.close!()
    : undefined

  return {
    get,
    set,
    has,
    delete: del,
    deleteByTags,
    clear,
    keys,
    stats,
    cleanup,
    close,
  }
}

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

  return createTenantAwareWrapper(strategy)
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
