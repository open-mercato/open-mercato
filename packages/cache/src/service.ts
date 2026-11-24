import type { CacheStrategy, CacheServiceOptions, CacheGetOptions, CacheSetOptions, CacheValue } from './types'
import { createMemoryStrategy } from './strategies/memory'
import { createRedisStrategy } from './strategies/redis'
import { createSqliteStrategy } from './strategies/sqlite'
import { createJsonFileStrategy } from './strategies/jsonfile'
import { getCurrentCacheTenant } from './tenantContext'
import { createHash } from 'node:crypto'
import { CacheDependencyUnavailableError } from './errors'
import { matchCacheKeyPattern } from './patterns'
import { parseCacheCompression, parseCacheCompressionMinBytes } from './codec'
import type { CacheCodecOptions } from './codec'
import type { CacheProviderHostContext, CacheProviderPlacement, ResolvedCacheProvider } from './provider'
import {
  CacheProviderError,
  createCacheProviderHostContext,
  getPreparedCacheProvider,
  readSelectedCacheProviderId,
  toSanitizedCacheProviderError,
} from './provider'

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
const TENANT_META_KEY_PATTERN = 'tenant:*:key:meta:*'
const TENANT_META_KEY_MARKER = ':key:meta:'

type TenantAwareCacheStrategy = CacheStrategy & {
  deleteByPatternsAcrossScopes(patterns: string[]): Promise<number>
}

function isCacheStrategyName(value: string | undefined): value is CacheStrategyName {
  if (!value) return false
  return KNOWN_STRATEGIES.includes(value as CacheStrategyName)
}

function resolveConfiguredStrategyType(options?: CacheServiceOptions): CacheStrategyName {
  const envStrategy = isCacheStrategyName(process.env.CACHE_STRATEGY)
    ? process.env.CACHE_STRATEGY
    : undefined
  return options?.strategy ?? envStrategy ?? 'memory'
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
  return createHash('sha256').update(input).digest('hex')
}

function storageKey(originalKey: string, prefixes: TenantPrefixes): string {
  return `${prefixes.keyPrefix}k:${hashIdentifier(originalKey)}`
}

function metaKey(originalKey: string, prefixes: TenantPrefixes): string {
  return `${prefixes.keyPrefix}meta:${hashIdentifier(originalKey)}`
}

/**
 * Physical key under which the tenant-aware wrapper stores a logical key's value
 * record. Providers receive these already-scoped keys; exposed so provider
 * conformance tooling can target a specific record without copying the layout.
 */
export function resolvePhysicalCacheValueKey(originalKey: string, tenantId: string | null): string {
  const tenant = normalizeTenantKey(tenantId)
  return storageKey(originalKey, {
    keyPrefix: `tenant:${tenant}:key:`,
    tagPrefix: `tenant:${tenant}:tag:`,
    scopeTag: `tenant:${tenant}:tag:__scope__`,
  })
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

function createTenantAwareWrapper(base: CacheStrategy, reportsBoundedCounters: boolean): TenantAwareCacheStrategy {
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
      if (pattern && !matchCacheKeyPattern(original, pattern)) continue
      originals.push(original)
    }
    return originals
  }

  const deleteByPatternsAcrossScopes = async (patterns: string[]) => {
    const normalizedPatterns = Array.from(new Set(patterns.map((pattern) => pattern.trim()).filter(Boolean)))
    if (normalizedPatterns.length === 0) return 0

    const metaKeys = await base.keys(TENANT_META_KEY_PATTERN)
    let deleted = 0
    for (const metadataKey of metaKeys) {
      const metadataValue = await base.get(metadataKey, { returnExpired: true })
      if (!metadataValue) continue
      const metadata = typeof metadataValue === 'string'
        ? null
        : (isCacheMetadata(metadataValue) ? metadataValue : null)
      const originalKey = typeof metadataValue === 'string' ? metadataValue : metadata?.key
      if (!originalKey || !normalizedPatterns.some((pattern) => matchCacheKeyPattern(originalKey, pattern))) {
        continue
      }

      const markerIndex = metadataKey.lastIndexOf(TENANT_META_KEY_MARKER)
      if (markerIndex < 0) continue
      const primaryKey = `${metadataKey.slice(0, markerIndex)}:key:k:${metadataKey.slice(markerIndex + TENANT_META_KEY_MARKER.length)}`
      if (await base.delete(primaryKey)) deleted += 1
      await base.delete(metadataKey)
    }
    return deleted
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
    // size/expired stay tenant-scoped (derived from this tenant's meta keys).
    // Only memory-backed strategies track the process-global bound counters, so
    // skip the extra base.stats() round-trip for redis/sqlite/jsonfile and omit
    // the optional fields (the stats() contract marks them optional). Keyed off
    // the configured strategy: a backend degraded to the memory fallback
    // intentionally does not surface these diagnostics.
    if (!reportsBoundedCounters) {
      return { size, expired }
    }
    const { evictions, sweeps, lastSweepReclaimed } = await base.stats()
    return { size, expired, evictions, sweeps, lastSweepReclaimed }
  }

  const cleanup = base.cleanup
    ? async () => normalizeDeletionCount(await base.cleanup!())
    : undefined

  const close = base.close
    ? async () => base.close!()
    : undefined
  const healthcheck = base.healthcheck
    ? async () => base.healthcheck!()
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
    healthcheck,
    cleanup,
    close,
    deleteByPatternsAcrossScopes,
  }
}

export type CacheSelection =
  | { kind: 'stock'; strategy: CacheStrategyName; placement: CacheProviderPlacement }
  | { kind: 'provider'; id: string; placement: CacheProviderPlacement }

type EffectiveCacheSelection =
  | { kind: 'stock'; strategy: CacheStrategyName }
  | { kind: 'provider'; provider: ResolvedCacheProvider }

const DEFAULT_PROVIDER_CONNECT_TIMEOUT_MS = 10_000
const REQUIRED_PROVIDER_STRATEGY_METHODS = [
  'get',
  'set',
  'has',
  'delete',
  'deleteByTags',
  'clear',
  'keys',
  'stats',
  'healthcheck',
  'close',
] as const

type ProviderStrategy = CacheStrategy & {
  healthcheck(): Promise<void>
  close(): Promise<void>
}

function resolveEffectiveSelection(options?: CacheServiceOptions): EffectiveCacheSelection {
  if (options?.strategy && options?.provider) {
    throw new CacheProviderError(
      'conflicting_selection',
      'Cache service options must not combine an explicit stock strategy with an explicit cache provider',
      { providerId: options.provider.id },
    )
  }
  if (options?.strategy) return { kind: 'stock', strategy: resolveConfiguredStrategyType(options) }
  if (options?.provider) return { kind: 'provider', provider: options.provider }
  if (readSelectedCacheProviderId(process.env)) {
    const prepared = getPreparedCacheProvider(process.env)
    if (prepared) return { kind: 'provider', provider: prepared }
  }
  return { kind: 'stock', strategy: resolveConfiguredStrategyType(options) }
}

/**
 * Describe the effective cache selection (stock strategy or registered provider)
 * without constructing a backend. Throws a `CacheProviderError` when a provider
 * is selected but invalid or not yet prepared.
 */
export function describeCacheSelection(options?: CacheServiceOptions): CacheSelection {
  const selection = resolveEffectiveSelection(options)
  if (selection.kind === 'provider') {
    return { kind: 'provider', id: selection.provider.id, placement: selection.provider.placement }
  }
  return {
    kind: 'stock',
    strategy: selection.strategy,
    placement: selection.strategy === 'redis' ? 'shared' : 'local',
  }
}

function resolveProviderConnectTimeoutMs(): number {
  const raw = process.env.CACHE_PROVIDER_CONNECT_TIMEOUT_MS
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PROVIDER_CONNECT_TIMEOUT_MS
}

function isProviderStrategy(value: unknown): value is ProviderStrategy {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return REQUIRED_PROVIDER_STRATEGY_METHODS.every((method) => typeof record[method] === 'function')
}

async function closeQuietly(value: unknown): Promise<void> {
  if (typeof value !== 'object' || value === null) return
  const close = (value as { close?: unknown }).close
  if (typeof close !== 'function') return
  try {
    await close.call(value)
  } catch {
    return
  }
}

function connectProviderStrategy(
  provider: ResolvedCacheProvider,
  context: CacheProviderHostContext,
  timeoutMs: number,
): Promise<ProviderStrategy> {
  return new Promise<ProviderStrategy>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new CacheProviderError(
        'timeout',
        `Cache provider "${provider.id}" did not initialize within ${timeoutMs}ms`,
        { providerId: provider.id },
      ))
    }, timeoutMs)
    if (typeof timer === 'object' && typeof timer.unref === 'function') timer.unref()

    Promise.resolve()
      .then(() => provider.definition.create(provider.config, context))
      .then(
        async (strategy) => {
          if (settled) {
            await closeQuietly(strategy)
            return
          }
          clearTimeout(timer)
          settled = true
          if (!isProviderStrategy(strategy)) {
            await closeQuietly(strategy)
            reject(new CacheProviderError(
              'invalid_registration',
              `Cache provider "${provider.id}" create() must return a cache strategy implementing ${REQUIRED_PROVIDER_STRATEGY_METHODS.join(', ')}`,
              { providerId: provider.id },
            ))
            return
          }
          resolve(strategy)
        },
        (error: unknown) => {
          if (settled) return
          clearTimeout(timer)
          settled = true
          reject(toSanitizedCacheProviderError(error, {
            message: `Cache provider "${provider.id}" failed to initialize`,
            providerId: provider.id,
          }))
        },
      )
  })
}

type ProviderOperation = 'get' | 'set' | 'has' | 'delete' | 'deleteByTags' | 'clear' | 'keys' | 'stats' | 'healthcheck' | 'cleanup' | 'close'

function createLazyProviderStrategy(
  provider: ResolvedCacheProvider,
  context: CacheProviderHostContext,
  timeoutMs: number,
): ProviderStrategy {
  let active: ProviderStrategy | null = null
  let pending: Promise<ProviderStrategy> | null = null
  let closing: Promise<void> | null = null
  let generation = 0

  const sanitize = (error: unknown, operation: ProviderOperation): CacheProviderError =>
    toSanitizedCacheProviderError(error, {
      message: `Cache provider "${provider.id}" ${operation} failed`,
      providerId: provider.id,
    })

  const ensure = async (operation: ProviderOperation): Promise<ProviderStrategy> => {
    if (closing) {
      try {
        await closing
      } catch (error) {
        throw sanitize(error, 'close')
      }
    }
    if (active) return active
    if (!pending) {
      const attemptGeneration = generation
      const attempt: Promise<ProviderStrategy> = connectProviderStrategy(provider, context, timeoutMs).then(
        async (strategy) => {
          if (attemptGeneration !== generation) {
            await closeQuietly(strategy)
            throw new CacheProviderError('unavailable', `Cache provider "${provider.id}" was closed during initialization`, { providerId: provider.id })
          }
          active = strategy
          if (pending === attempt) pending = null
          return strategy
        },
        (error: unknown) => {
          if (pending === attempt) pending = null
          throw error
        },
      )
      pending = attempt
    }
    try {
      return await pending
    } catch (error) {
      throw sanitize(error, operation)
    }
  }

  const run = async <T>(operation: ProviderOperation, call: (strategy: ProviderStrategy) => Promise<T> | T): Promise<T> => {
    const strategy = await ensure(operation)
    try {
      return await call(strategy)
    } catch (error) {
      throw sanitize(error, operation)
    }
  }

  const close = async (): Promise<void> => {
    if (!closing) {
      const current = active
      const inflight = pending
      active = null
      pending = null
      generation += 1
      closing = (async () => {
        if (inflight) await inflight.catch(() => undefined)
        if (current) {
          try {
            await current.close()
          } catch (error) {
            throw sanitize(error, 'close')
          }
        }
      })().finally(() => {
        closing = null
      })
    }
    return closing
  }

  return {
    get: (key, options) => run('get', (strategy) => strategy.get(key, options)),
    set: (key, value, options) => run('set', (strategy) => strategy.set(key, value, options)),
    has: (key) => run('has', (strategy) => strategy.has(key)),
    delete: (key) => run('delete', (strategy) => strategy.delete(key)),
    deleteByTags: (tags) => run('deleteByTags', (strategy) => strategy.deleteByTags(tags)),
    clear: () => run('clear', (strategy) => strategy.clear()),
    keys: (pattern) => run('keys', (strategy) => strategy.keys(pattern)),
    stats: () => run('stats', (strategy) => strategy.stats()),
    healthcheck: () => run('healthcheck', (strategy) => strategy.healthcheck()),
    cleanup: () => run('cleanup', (strategy) => (strategy.cleanup ? strategy.cleanup() : 0)),
    close,
  }
}

function resolveDefaultTtl(options?: CacheServiceOptions): number | undefined {
  const envTtl = process.env.CACHE_TTL
  const parsedEnvTtl = envTtl ? Number.parseInt(envTtl, 10) : undefined
  return options?.defaultTtl ?? (typeof parsedEnvTtl === 'number' && Number.isFinite(parsedEnvTtl) ? parsedEnvTtl : undefined)
}

function resolveCodecOptions(options?: CacheServiceOptions): CacheCodecOptions {
  return {
    compression: options?.compression ?? parseCacheCompression(process.env.CACHE_COMPRESSION),
    compressionMinBytes: options?.compressionMinBytes ?? parseCacheCompressionMinBytes(process.env.CACHE_COMPRESSION_MIN_BYTES),
  }
}

function createProviderTenantAwareStrategy(provider: ResolvedCacheProvider, options?: CacheServiceOptions): TenantAwareCacheStrategy {
  const context = createCacheProviderHostContext(provider, {
    defaultTtl: resolveDefaultTtl(options),
    codec: resolveCodecOptions(options),
  })
  const lazyStrategy = createLazyProviderStrategy(provider, context, resolveProviderConnectTimeoutMs())
  return createTenantAwareWrapper(lazyStrategy, false)
}

function createTenantAwareStrategyForSelection(
  selection: EffectiveCacheSelection,
  options?: CacheServiceOptions,
): TenantAwareCacheStrategy {
  if (selection.kind === 'provider') return createProviderTenantAwareStrategy(selection.provider, options)
  return createStockTenantAwareStrategy(selection.strategy, options)
}

function createConfiguredTenantAwareStrategy(options?: CacheServiceOptions): TenantAwareCacheStrategy {
  return createTenantAwareStrategyForSelection(resolveEffectiveSelection(options), options)
}

function createStockTenantAwareStrategy(strategyType: CacheStrategyName, options?: CacheServiceOptions): TenantAwareCacheStrategy {
  const defaultTtl = resolveDefaultTtl(options)

  const envMaxEntries = process.env.CACHE_MEMORY_MAX_ENTRIES
  const parsedEnvMaxEntries = envMaxEntries ? Number.parseInt(envMaxEntries, 10) : undefined
  const maxEntries = options?.maxEntries ?? (typeof parsedEnvMaxEntries === 'number' && Number.isFinite(parsedEnvMaxEntries) ? parsedEnvMaxEntries : undefined)

  const codecOptions = resolveCodecOptions(options)

  const baseStrategy = createStrategyForType(strategyType, options, defaultTtl, maxEntries, codecOptions)
  const resilientStrategy = withDependencyFallback(baseStrategy, strategyType, defaultTtl, maxEntries)
  const reportsBoundedCounters = strategyType === 'memory'

  return createTenantAwareWrapper(resilientStrategy, reportsBoundedCounters)
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
 * - CACHE_COMPRESSION: 'off' | 'zstd' | 'gzip' value compression for redis/sqlite (default: 'off')
 * - CACHE_COMPRESSION_MIN_BYTES: smallest serialized entry that gets compressed (default: 1024)
 *
 * @example
 * const cache = createCacheService({ strategy: 'memory', defaultTtl: 60000 })
 * await cache.set('user:123', { name: 'John' }, { tags: ['users', 'user:123'] })
 * const user = await cache.get('user:123')
 * await cache.deleteByTags(['users']) // Invalidate all user-related cache
 */
export function createCacheService(options?: CacheServiceOptions): CacheStrategy {
  return createConfiguredTenantAwareStrategy(options)
}

/**
 * Delete matching logical keys across every tenant scope in the configured
 * stock cache backend without bootstrapping application DI or querying the
 * tenant database. Intended for maintenance tasks that already operate on all
 * scopes, such as post-generation structural invalidation.
 */
export async function purgeConfiguredCachePatternsAcrossTenantScopes(
  patterns: string[],
  options?: CacheServiceOptions,
): Promise<number> {
  // A newly-created memory strategy cannot reach the running app's process-local
  // cache, so constructing one here would only allocate and immediately discard
  // an empty store. Persistent stock backends remain cross-process maintainable.
  const selection = resolveEffectiveSelection(options)
  if (selection.kind === 'stock' && selection.strategy === 'memory') return 0

  const cache = createTenantAwareStrategyForSelection(selection, options)
  try {
    return await cache.deleteByPatternsAcrossScopes(patterns)
  } finally {
    await cache.close?.()
  }
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

  async stats(): Promise<{
    size: number
    expired: number
    evictions?: number
    sweeps?: number
    lastSweepReclaimed?: number
  }> {
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

function createStrategyForType(strategyType: CacheStrategyName, options?: CacheServiceOptions, defaultTtl?: number, maxEntries?: number, codecOptions?: CacheCodecOptions): CacheStrategy {
  switch (strategyType) {
    case 'redis':
      return createRedisStrategy(options?.redisUrl, { defaultTtl, ...codecOptions })
    case 'sqlite':
      return createSqliteStrategy(options?.sqlitePath, { defaultTtl, ...codecOptions })
    case 'jsonfile':
      return createJsonFileStrategy(options?.jsonFilePath, { defaultTtl })
    case 'memory':
    default:
      return createMemoryStrategy({ defaultTtl, maxEntries })
  }
}

function describeDependencyFailure(error: CacheDependencyUnavailableError): string {
  const originalError = error.originalError
  if (!(originalError instanceof Error)) {
    return `missing dependency: ${error.dependency}`
  }

  const message = originalError.message.trim()
  if (message.length === 0) {
    return `missing dependency: ${error.dependency}`
  }

  if (message.includes('compiled against a different Node.js version') || message.includes('NODE_MODULE_VERSION')) {
    return `${error.dependency} native module needs rebuild for the current Node.js version`
  }

  if (message.includes('Cannot find module')) {
    return `missing dependency: ${error.dependency}`
  }

  return `${error.dependency} failed to load`
}

function withDependencyFallback(strategy: CacheStrategy, strategyType: CacheStrategyName, defaultTtl?: number, maxEntries?: number): CacheStrategy {
  if (strategyType === 'memory') return strategy

  let activeStrategy = strategy
  let fallbackStrategy: CacheStrategy | null = null
  let warned = false

  const ensureFallback = (error: CacheDependencyUnavailableError) => {
    if (!fallbackStrategy) {
      fallbackStrategy = createMemoryStrategy({ defaultTtl, maxEntries })
    }
    if (!warned) {
      const dependencyMessage = error.dependency
        ? ` (${describeDependencyFailure(error)})`
        : ''
      console.warn(`[cache] ${error.strategy} strategy unavailable${dependencyMessage}. Falling back to memory strategy.`)
      warned = true
    }
    activeStrategy = fallbackStrategy
  }

  const wrapMethod = <K extends keyof CacheStrategy>(method: K): CacheStrategy[K] => {
    const handler = async (...args: Parameters<NonNullable<CacheStrategy[K]>>) => {
      const fn = activeStrategy[method] as ((...methodArgs: Parameters<NonNullable<CacheStrategy[K]>>) => ReturnType<NonNullable<CacheStrategy[K]>>) | undefined
      if (!fn) {
        return undefined as Awaited<ReturnType<NonNullable<CacheStrategy[K]>>>
      }

      try {
        return await fn(...args)
      } catch (error) {
        if (error instanceof CacheDependencyUnavailableError) {
          ensureFallback(error)
          const fallbackFn = activeStrategy[method] as ((...methodArgs: Parameters<NonNullable<CacheStrategy[K]>>) => ReturnType<NonNullable<CacheStrategy[K]>>) | undefined
          if (!fallbackFn) {
            return undefined as Awaited<ReturnType<NonNullable<CacheStrategy[K]>>>
          }
          return fallbackFn(...args)
        }
        throw error
      }
    }

    return handler as CacheStrategy[K]
  }

  return {
    get: wrapMethod('get'),
    set: wrapMethod('set'),
    has: wrapMethod('has'),
    delete: wrapMethod('delete'),
    deleteByTags: wrapMethod('deleteByTags'),
    clear: wrapMethod('clear'),
    keys: wrapMethod('keys'),
    stats: wrapMethod('stats'),
    healthcheck: typeof strategy.healthcheck === 'function'
      ? async () => strategy.healthcheck!()
      : undefined,
    cleanup: typeof strategy.cleanup === 'function' ? wrapMethod('cleanup') : undefined,
    close: typeof strategy.close === 'function' ? wrapMethod('close') : undefined,
  }
}
