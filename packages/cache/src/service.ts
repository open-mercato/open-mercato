import type { CacheStrategy, CacheServiceOptions, CacheGetOptions, CacheSetOptions, CacheValue } from './types'
import { createMemoryStrategy } from './strategies/memory'
import { createRedisStrategy } from './strategies/redis'
import { createSqliteStrategy } from './strategies/sqlite'
import { createJsonFileStrategy } from './strategies/jsonfile'
import { getCurrentCacheTenant } from './tenantContext'
import { createHash } from 'node:crypto'

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

type CacheMetadata = {
  key: string
  expiresAt: number | null
}

function isCacheMetadata(value: CacheValue | null): value is CacheMetadata {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const record = value as Record<string, unknown>
  const hasValidKey = typeof record.key === 'string'
  const hasValidExpiresAt =
    !('expiresAt' in record)
    || record.expiresAt === null
    || typeof record.expiresAt === 'number'

  return hasValidKey && hasValidExpiresAt
}

type CacheStrategyName = NonNullable<CacheServiceOptions['strategy']>
const KNOWN_STRATEGIES: CacheStrategyName[] = ['memory', 'redis', 'sqlite', 'jsonfile']

function isCacheStrategyName(value: string | undefined): value is CacheStrategyName {
  if (!value) return false
  return KNOWN_STRATEGIES.includes(value as CacheStrategyName)
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

function hashIdentifier(input: string): string {
  return createHash('sha1').update(input).digest('hex')
}

function storageKey(originalKey: string, prefixes: TenantPrefixes): string {
  return `${prefixes.keyPrefix}k:${hashIdentifier(originalKey)}`
}

function metaKey(originalKey: string, prefixes: TenantPrefixes): string {
  return `${prefixes.keyPrefix}meta:${hashIdentifier(originalKey)}`
}

function hashedTag(tag: string, prefixes: TenantPrefixes): string {
  return `${prefixes.tagPrefix}t:${hashIdentifier(tag)}`
}

function buildTagSet(tags: string[] | undefined, prefixes: TenantPrefixes, includeScope: boolean): string[] {
  const scoped = new Set<string>()
  if (includeScope) scoped.add(prefixes.scopeTag)
  if (Array.isArray(tags)) {
    for (const tag of tags) {
      if (typeof tag === 'string' && tag.length > 0) scoped.add(hashedTag(tag, prefixes))
    }
  }
  return Array.from(scoped)
}

function matchPattern(value: string, pattern: string): boolean {
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  const regex = new RegExp(`^${regexPattern}$`)
  return regex.test(value)
}

function createTenantAwareWrapper(base: CacheStrategy): CacheStrategy {
  function normalizeDeletionCount(raw: number): number {
    if (!raw) return raw
    if (!Number.isFinite(raw)) return raw
    return Math.ceil(raw / 2)
  }

  const get = async (key: string, options?: CacheGetOptions) => {
    const prefixes = resolveTenantPrefixes()
    return base.get(storageKey(key, prefixes), options)
  }

  const set = async (key: string, value: CacheValue, options?: CacheSetOptions) => {
    const prefixes = resolveTenantPrefixes()
    const hashedTags = buildTagSet(options?.tags, prefixes, true)
    const ttl = options?.ttl ?? undefined
    const nextOptions: CacheSetOptions | undefined = options
      ? { ...options, tags: hashedTags }
      : { tags: hashedTags }
    await base.set(storageKey(key, prefixes), value, nextOptions)
    const metaPayload: CacheMetadata = { key, expiresAt: ttl ? Date.now() + ttl : null }
    await base.set(metaKey(key, prefixes), metaPayload, {
      ttl,
      tags: hashedTags,
    })
  }

  const has = async (key: string) => {
    const prefixes = resolveTenantPrefixes()
    return base.has(storageKey(key, prefixes))
  }

  const del = async (key: string) => {
    const prefixes = resolveTenantPrefixes()
    const primary = await base.delete(storageKey(key, prefixes))
    await base.delete(metaKey(key, prefixes))
    return primary
  }

  const deleteByTags = async (tags: string[]) => {
    const prefixes = resolveTenantPrefixes()
    const scopedTags = buildTagSet(tags, prefixes, false)
    if (!scopedTags.length) return 0
    const removed = await base.deleteByTags(scopedTags)
    return normalizeDeletionCount(removed)
  }

  const clear = async () => {
    const prefixes = resolveTenantPrefixes()
    const removed = await base.deleteByTags([prefixes.scopeTag])
    return normalizeDeletionCount(removed)
  }

  const keys = async (pattern?: string) => {
    const prefixes = resolveTenantPrefixes()
    const metaPattern = `${prefixes.keyPrefix}meta:*`
    const metaKeys = await base.keys(metaPattern)
    const originals: string[] = []
    for (const metaKey of metaKeys) {
      const metaValue = await base.get(metaKey, { returnExpired: true })
      if (!metaValue) continue
      const metadata = typeof metaValue === 'string' ? null : (isCacheMetadata(metaValue) ? metaValue : null)
      const original = typeof metaValue === 'string' ? metaValue : metadata?.key
      if (!original) continue
      if (pattern && !matchPattern(original, pattern)) continue
      originals.push(original)
    }
    return originals
  }

  const stats = async () => {
    const prefixes = resolveTenantPrefixes()
    const metaKeys = await base.keys(`${prefixes.keyPrefix}meta:*`)
    let size = 0
    let expired = 0
    const now = Date.now()
    for (const metaKey of metaKeys) {
      const metaValue = await base.get(metaKey, { returnExpired: true })
      if (!metaValue) continue
      const metadata = typeof metaValue === 'string' ? null : (isCacheMetadata(metaValue) ? metaValue : null)
      const original = typeof metaValue === 'string' ? metaValue : metadata?.key
      if (!original) continue
      size++
      const expiresAt = metadata?.expiresAt ?? null
      if (expiresAt !== null && expiresAt <= now) expired++
    }
    return { size, expired }
  }

  const cleanup = base.cleanup
    ? async () => normalizeDeletionCount(await base.cleanup!())
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
  const envStrategy = isCacheStrategyName(process.env.CACHE_STRATEGY)
    ? process.env.CACHE_STRATEGY
    : undefined
  const strategyType: CacheStrategyName = options?.strategy ?? envStrategy ?? 'memory'

  const envTtl = process.env.CACHE_TTL
  const parsedEnvTtl = envTtl ? Number.parseInt(envTtl, 10) : undefined
  const defaultTtl = options?.defaultTtl ?? (typeof parsedEnvTtl === 'number' && Number.isFinite(parsedEnvTtl) ? parsedEnvTtl : undefined)

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

  async get(key: string, options?: CacheGetOptions): Promise<CacheValue | null> {
    return this.strategy.get(key, options)
  }

  async set(key: string, value: CacheValue, options?: CacheSetOptions): Promise<void> {
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
