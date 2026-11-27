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

type CacheProviderEntry = CacheMetadata & { value: CacheValue }
type CacheRecordLayout =
  | { kind: 'stock'; reportsBoundedCounters: boolean }
  | { kind: 'provider'; defaultTtl?: number }

type CacheStrategyName = NonNullable<CacheServiceOptions['strategy']>
const PROVIDER_ENTRY_PREFIX = 'entry:v1:'
const TENANT_META_KEY_MARKER = ':key:meta:'

type TenantAwareCacheStrategy = CacheStrategy & {
  deleteByPatternsAcrossScopes(patterns: string[]): Promise<number>
}

function isCacheStrategyName(value: string | undefined): value is CacheStrategyName {
  if (!value) return false
  return Object.hasOwn(stockProviderFactories, value)
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

function providerEntryKey(originalKey: string, keyPrefix: string): string {
  return `${keyPrefix}${PROVIDER_ENTRY_PREFIX}${hashIdentifier(originalKey)}`
}

function isCacheProviderEntry(value: CacheValue | null): value is CacheProviderEntry {
  return isCacheMetadata(value) && Object.hasOwn(value, 'value')
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
  return providerEntryKey(originalKey, `tenant:${normalizeTenantKey(tenantId)}:key:`)
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

function createTenantAwareWrapper(base: CacheStrategy, layout: CacheRecordLayout): TenantAwareCacheStrategy {
  const recordPrefix = layout.kind === 'provider' ? PROVIDER_ENTRY_PREFIX : 'meta:'

  function valueKey(key: string, prefixes: TenantPrefixes) {
    return layout.kind === 'provider' ? providerEntryKey(key, prefixes.keyPrefix) : storageKey(key, prefixes)
  }

  function normalizeDeletionCount(raw: number): number {
    if (layout.kind === 'provider' || !raw || !Number.isFinite(raw)) return raw
    return Math.ceil(raw / 2)
  }

  async function* scanRecords(keyPrefix: string) {
    for (const physicalKey of await base.keys(`${keyPrefix}${recordPrefix}*`)) {
      const record = await base.get(physicalKey, { returnExpired: true })
      if (layout.kind === 'stock' && typeof record === 'string') {
        yield { physicalKey, key: record, expiresAt: null }
        continue
      }
      if (!isCacheMetadata(record) || (layout.kind === 'provider' && !isCacheProviderEntry(record))) continue
      yield { physicalKey, key: record.key, expiresAt: record.expiresAt ?? null }
    }
  }

  const get = async (key: string, options?: CacheGetOptions) => {
    const record = await base.get(valueKey(key, resolveTenantPrefixes()), options)
    if (layout.kind === 'stock') return record
    return isCacheProviderEntry(record) ? record.value : null
  }

  const set = async (key: string, value: CacheValue, options?: CacheSetOptions) => {
    const prefixes = resolveTenantPrefixes()
    const tags = buildTagSet(options?.tags, prefixes, true)
    const nextOptions: CacheSetOptions = { ...options, tags }
    if (layout.kind === 'provider') {
      const ttl = options?.ttl ?? layout.defaultTtl
      const entry: CacheProviderEntry = { key, value, expiresAt: ttl && ttl > 0 ? Date.now() + ttl : null }
      await base.set(valueKey(key, prefixes), entry, nextOptions)
      return
    }

    await base.set(valueKey(key, prefixes), value, nextOptions)
    const ttl = options?.ttl ?? undefined
    const metadata: CacheMetadata = { key, expiresAt: ttl ? Date.now() + ttl : null }
    await base.set(metaKey(key, prefixes), metadata, { ttl, tags })
  }

  const has = async (key: string) => base.has(valueKey(key, resolveTenantPrefixes()))

  const del = async (key: string) => {
    const prefixes = resolveTenantPrefixes()
    const primary = await base.delete(valueKey(key, prefixes))
    if (layout.kind === 'stock') await base.delete(metaKey(key, prefixes))
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
    const originals: string[] = []
    for await (const { key } of scanRecords(resolveTenantPrefixes().keyPrefix)) {
      if (layout.kind === 'stock' && !key) continue
      if (pattern && !matchCacheKeyPattern(key, pattern)) continue
      originals.push(key)
    }
    return originals
  }

  const deleteByPatternsAcrossScopes = async (patterns: string[]) => {
    const normalizedPatterns = Array.from(new Set(patterns.map((pattern) => pattern.trim()).filter(Boolean)))
    if (normalizedPatterns.length === 0) return 0

    let deleted = 0
    for await (const { physicalKey, key } of scanRecords('tenant:*:key:')) {
      if (layout.kind === 'stock' && !key) continue
      if (!normalizedPatterns.some((pattern) => matchCacheKeyPattern(key, pattern))) continue
      if (layout.kind === 'provider') {
        if (await base.delete(physicalKey)) deleted += 1
        continue
      }

      const markerIndex = physicalKey.lastIndexOf(TENANT_META_KEY_MARKER)
      if (markerIndex < 0) continue
      const primaryKey = `${physicalKey.slice(0, markerIndex)}:key:k:${physicalKey.slice(markerIndex + TENANT_META_KEY_MARKER.length)}`
      if (await base.delete(primaryKey)) deleted += 1
      await base.delete(physicalKey)
    }
    return deleted
  }

  const stats = async () => {
    let size = 0
    let expired = 0
    const now = Date.now()
    for await (const { key, expiresAt } of scanRecords(resolveTenantPrefixes().keyPrefix)) {
      if (layout.kind === 'stock' && !key) continue
      size++
      if (expiresAt !== null && expiresAt <= now) expired++
    }
    if (layout.kind !== 'stock' || !layout.reportsBoundedCounters) {
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
const DEFAULT_PROVIDER_RETRY_COOLDOWN_MS = 1_000
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

function resolveProviderRetryCooldownMs(): number {
  const raw = process.env.CACHE_PROVIDER_RETRY_COOLDOWN_MS
  const parsed = raw !== undefined && raw.trim().length > 0 ? Number(raw) : Number.NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_PROVIDER_RETRY_COOLDOWN_MS
}

function isProviderStrategy(value: unknown): value is ProviderStrategy {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return REQUIRED_PROVIDER_STRATEGY_METHODS.every((method) => typeof record[method] === 'function')
}

async function closeQuietly(value: unknown): Promise<void> {
  if (typeof value !== 'object' || value === null) return
  try {
    const close = (value as { close?: unknown }).close
    if (typeof close === 'function') await close.call(value)
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
        (strategy) => {
          if (settled) {
            void closeQuietly(strategy)
            return
          }
          clearTimeout(timer)
          settled = true
          try {
            if (!isProviderStrategy(strategy)) {
              throw new CacheProviderError(
                'invalid_registration',
                `Cache provider "${provider.id}" create() must return a cache strategy implementing ${REQUIRED_PROVIDER_STRATEGY_METHODS.join(', ')}`,
                { providerId: provider.id },
              )
            }
            resolve(strategy)
          } catch (error) {
            void closeQuietly(strategy)
            reject(toSanitizedCacheProviderError(error, {
              message: `Cache provider "${provider.id}" failed to initialize`,
              providerId: provider.id,
            }))
          }
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
  retryCooldownMs: number,
): ProviderStrategy {
  let active: ProviderStrategy | null = null
  let pending: Promise<ProviderStrategy> | null = null
  let closing: Promise<void> | null = null
  let closed = false
  let lastFailure: { error: CacheProviderError; at: number } | null = null
  let generation = 0

  const sanitize = (error: unknown, operation: ProviderOperation): CacheProviderError =>
    toSanitizedCacheProviderError(error, {
      message: `Cache provider "${provider.id}" ${operation} failed`,
      providerId: provider.id,
    })

  const ensure = async (operation: ProviderOperation): Promise<ProviderStrategy> => {
    if (closed) {
      throw new CacheProviderError('unavailable', `Cache provider "${provider.id}" is closed`, { providerId: provider.id })
    }
    if (active) return active
    if (!pending) {
      if (lastFailure && Date.now() - lastFailure.at < retryCooldownMs) throw lastFailure.error
      const attemptGeneration = generation
      const attempt: Promise<ProviderStrategy> = connectProviderStrategy(provider, context, timeoutMs).then(
        async (strategy) => {
          if (attemptGeneration !== generation) {
            await closeQuietly(strategy)
            throw new CacheProviderError('unavailable', `Cache provider "${provider.id}" was closed during initialization`, { providerId: provider.id })
          }
          active = strategy
          lastFailure = null
          if (pending === attempt) pending = null
          return strategy
        },
        (error: unknown) => {
          if (pending === attempt) pending = null
          if (attemptGeneration === generation) {
            lastFailure = { error: sanitize(error, operation), at: Date.now() }
          }
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
      closed = true
      active = null
      pending = null
      lastFailure = null
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
      })()
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
  const lazyStrategy = createLazyProviderStrategy(
    provider,
    context,
    resolveProviderConnectTimeoutMs(),
    resolveProviderRetryCooldownMs(),
  )
  return createTenantAwareWrapper(lazyStrategy, { kind: 'provider', defaultTtl: context.defaultTtl })
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

  const createStrategy = isCacheStrategyName(strategyType) ? stockProviderFactories[strategyType] : stockProviderFactories.memory
  const baseStrategy = createStrategy({ options, defaultTtl, maxEntries, codecOptions })
  const resilientStrategy = withDependencyFallback(baseStrategy, strategyType, defaultTtl, maxEntries)
  return createTenantAwareWrapper(resilientStrategy, { kind: 'stock', reportsBoundedCounters: strategyType === 'memory' })
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

type StockFactoryOptions = {
  defaultTtl?: number
  maxEntries?: number
  codecOptions: CacheCodecOptions
  options?: CacheServiceOptions
}

/** Stock npm factories are available even to synchronous pre-bootstrap callers. */
const stockProviderFactories: Record<CacheStrategyName, (config: StockFactoryOptions) => CacheStrategy> = {
  memory: ({ defaultTtl, maxEntries }) => createMemoryStrategy({ defaultTtl, maxEntries }),
  redis: ({ defaultTtl, codecOptions, options }) => createRedisStrategy(options?.redisUrl, { defaultTtl, ...codecOptions }),
  sqlite: ({ defaultTtl, codecOptions, options }) => createSqliteStrategy(options?.sqlitePath, { defaultTtl, ...codecOptions }),
  jsonfile: ({ defaultTtl, options }) => createJsonFileStrategy(options?.jsonFilePath, { defaultTtl }),
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
      fallbackStrategy = stockProviderFactories.memory({ defaultTtl, maxEntries, codecOptions: {} })
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
