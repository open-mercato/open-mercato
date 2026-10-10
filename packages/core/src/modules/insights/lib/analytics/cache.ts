import { createHash, randomUUID } from 'node:crypto'
import type { ZodType } from 'zod'
import { runWithCacheTenant, type CacheStrategy } from '@open-mercato/cache'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { AnalyticsViewer } from './types'

const logger = createLogger('insights').child({ component: 'xray-analytics-cache' })

export const XRAY_ANALYTICS_CACHE_VERSION = 'v2'

export const XRAY_ANALYTICS_CACHE_TTL_MS = 120_000

/** Tenant-scoped key of the shared invalidation generation (a random token per invalidation). */
export const XRAY_ANALYTICS_GENERATION_KEY = `insights:xray:${XRAY_ANALYTICS_CACHE_VERSION}:generation`

/** Lifetime of the generation token: far beyond any computation and the result TTL. */
export const XRAY_ANALYTICS_GENERATION_TTL_MS = 10 * 60_000

export const XRAY_ANALYTICS_TAG = 'insights:xray:analytics'

export const XRAY_ANALYTICS_TENANT_WIDE_TAG = 'insights:xray:tenant-wide'

export function organizationCacheTag(organizationId: string): string {
  return `insights:xray:org:${organizationId.toLowerCase()}`
}

function canonicalIds(organizationIds: readonly string[]): string[] {
  return Array.from(new Set(organizationIds.map((organizationId) => organizationId.toLowerCase()))).sort((left, right) => left.localeCompare(right))
}

/**
 * Tags of a cached result: one per organization it covers, or the tenant-wide tag for an
 * unrestricted reader (any organization's change invalidates it), plus the analytics tag.
 */
export function analyticsCacheTags(organizationIds: readonly string[] | null): string[] {
  const tags = organizationIds === null
    ? [XRAY_ANALYTICS_TENANT_WIDE_TAG]
    : canonicalIds(organizationIds).map(organizationCacheTag)
  return [...tags, XRAY_ANALYTICS_TAG]
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return Object.fromEntries(entries.map(([key, entry]) => [key, canonicalize(entry)]))
  }
  return value
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * What a viewer is allowed to see, as a digest: the granted features (as granted, wildcards
 * included), the per-person grant and, for a per-person read, the viewer itself. Two viewers
 * share a cached result only when their fingerprints match.
 */
export function permissionFingerprint(viewer: AnalyticsViewer, options: { perPerson: boolean }): string {
  const features = Array.from(new Set(viewer.features)).sort((left, right) => left.localeCompare(right))
  return sha256(canonicalJson({ features, individuals: viewer.canViewIndividuals, userId: options.perPerson ? viewer.userId : null }))
}

export type AnalyticsCacheKeyInput = {
  tenantId: string
  organizationIds: readonly string[] | null
  permissionFingerprint: string
  settingsFingerprint: string
  operation: string
  params: unknown
}

/**
 * Cache key of one analytics result: tenant, organization filter, permissions, settings,
 * params. Tenant and organization ids are compared lower-case.
 */
export function buildAnalyticsCacheKey(input: AnalyticsCacheKeyInput): string {
  const tenantId = input.tenantId.toLowerCase()
  const organizationIds = input.organizationIds === null ? null : canonicalIds(input.organizationIds)
  const digest = sha256(canonicalJson({
    tenantId,
    organizationIds,
    permissions: input.permissionFingerprint,
    settings: input.settingsFingerprint,
    params: input.params,
  }))
  return `insights:xray:${XRAY_ANALYTICS_CACHE_VERSION}:${input.operation}:${tenantId}:${digest}`
}

type InflightEntry = {
  tenantId: string
  tags: readonly string[]
  promise: Promise<unknown>
}

/** Process-wide single-flight and invalidation state, shared by every request's analytics. */
export type AnalyticsCacheState = {
  inflight: Map<string, InflightEntry>
  generations: Map<string, number>
}

const STATE_KEY = Symbol.for('@open-mercato/core/insights/xray-analytics-cache')

type GlobalWithAnalyticsCacheState = typeof globalThis & {
  [STATE_KEY]?: AnalyticsCacheState
}

export function createAnalyticsCacheState(): AnalyticsCacheState {
  return { inflight: new Map(), generations: new Map() }
}

export function sharedAnalyticsCacheState(): AnalyticsCacheState {
  const scope = globalThis as GlobalWithAnalyticsCacheState
  if (!scope[STATE_KEY]) scope[STATE_KEY] = createAnalyticsCacheState()
  return scope[STATE_KEY]
}

function generationKey(tenantId: string, tag: string): string {
  return `${tenantId}\u001f${tag}`
}

function reportCacheFailure(action: string, error: unknown): void {
  logger.warn('[internal] X-Ray analytics cache operation failed', { action, err: error })
  getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.xray_analytics_cache_failed', attributes: { action } })
}

export type CachedComputation<TValue> = {
  key: string
  tenantId: string
  tags: readonly string[]
  schema: ZodType<TValue>
  ttlMs?: number
}

export type AnalyticsCache = {
  getOrCompute: <TValue>(entry: CachedComputation<TValue>, compute: () => Promise<TValue>) => Promise<TValue>
  invalidate: (tenantId: string, organizationIds: readonly string[]) => Promise<void>
}

type GenerationSnapshot = {
  local: number[]
  shared: string | null
  readable: boolean
}

function sameGeneration(before: GenerationSnapshot, after: GenerationSnapshot): boolean {
  return before.readable
    && after.readable
    && before.shared === after.shared
    && before.local.length === after.local.length
    && before.local.every((generation, index) => generation === after.local[index])
}

function readToken(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const token = (value as { token?: unknown }).token
  return typeof token === 'string' ? token : null
}

/**
 * Read-through cache of analytics results over the DI cache service (tenant-scoped through
 * `runWithCacheTenant`, tag invalidation per organization) with process-local single-flight:
 * concurrent identical requests share one computation. Invalidation is ordered "generation
 * first, then `deleteByTags`": it bumps a process-local generation per tag and writes a fresh
 * random token under the tenant's shared generation key in the cache service itself, so on a
 * shared strategy (Redis, SQLite) an invalidation from a worker process is seen by web
 * processes. A computation stores its result only when the generations read before it started
 * still hold afterwards, and re-reads them after the write, deleting the entry when an
 * invalidation slipped in between (an invalidation after that re-read deletes the entry with
 * its own `deleteByTags`). Any shared-generation read failure skips the write. Residual: the
 * memory strategy is per process anyway (another process's invalidation never reaches it), and
 * every entry expires after `XRAY_ANALYTICS_CACHE_TTL_MS` (120 s). The shared generation is
 * per tenant, so an organization's invalidation also skips writes of other organizations'
 * computations in flight. Cached values are validated against the result schema; a cache
 * failure degrades to a live computation.
 */
export function createAnalyticsCache(cache: CacheStrategy | null, state: AnalyticsCacheState = sharedAnalyticsCacheState()): AnalyticsCache {
  const localGenerations = (tenantId: string, tags: readonly string[]) => tags.map((tag) => state.generations.get(generationKey(tenantId, tag)) ?? 0)

  async function snapshot(tenantId: string, tags: readonly string[]): Promise<GenerationSnapshot> {
    const local = localGenerations(tenantId, tags)
    if (!cache) return { local, shared: null, readable: true }
    try {
      const stored = await runWithCacheTenant(tenantId, () => cache.get(XRAY_ANALYTICS_GENERATION_KEY))
      return { local, shared: readToken(stored), readable: true }
    } catch (error) {
      reportCacheFailure('get_generation', error)
      return { local, shared: null, readable: false }
    }
  }

  async function read<TValue>(entry: CachedComputation<TValue>, tenantId: string): Promise<TValue | null> {
    if (!cache) return null
    try {
      const stored = await runWithCacheTenant(tenantId, () => cache.get(entry.key))
      if (stored === null || stored === undefined) return null
      const parsed = entry.schema.safeParse(stored)
      return parsed.success ? parsed.data : null
    } catch (error) {
      reportCacheFailure('get', error)
      return null
    }
  }

  async function write<TValue>(entry: CachedComputation<TValue>, tenantId: string, value: TValue): Promise<void> {
    if (!cache) return
    try {
      await runWithCacheTenant(tenantId, () => cache.set(entry.key, structuredClone(value), {
        ttl: entry.ttlMs ?? XRAY_ANALYTICS_CACHE_TTL_MS,
        tags: [...entry.tags],
      }))
    } catch (error) {
      reportCacheFailure('set', error)
    }
  }

  async function remove(key: string, tenantId: string): Promise<void> {
    if (!cache) return
    try {
      await runWithCacheTenant(tenantId, () => cache.delete(key))
    } catch (error) {
      reportCacheFailure('delete', error)
    }
  }

  async function getOrCompute<TValue>(entry: CachedComputation<TValue>, compute: () => Promise<TValue>): Promise<TValue> {
    const tenantId = entry.tenantId.toLowerCase()
    const cached = await read(entry, tenantId)
    if (cached !== null) return cached
    const running = state.inflight.get(entry.key)
    if (running && running.tenantId === tenantId) return entry.schema.parse(await running.promise)
    const started: { generations: GenerationSnapshot | null } = { generations: null }
    const promise = (async () => {
      started.generations = await snapshot(tenantId, entry.tags)
      return compute()
    })()
    const inflight: InflightEntry = { tenantId, tags: entry.tags, promise }
    state.inflight.set(entry.key, inflight)
    try {
      const value = await promise
      const before = started.generations
      if (cache && before && state.inflight.get(entry.key) === inflight && sameGeneration(before, await snapshot(tenantId, entry.tags))) {
        await write(entry, tenantId, value)
        if (!sameGeneration(before, await snapshot(tenantId, entry.tags))) await remove(entry.key, tenantId)
      }
      return value
    } finally {
      if (state.inflight.get(entry.key) === inflight) state.inflight.delete(entry.key)
    }
  }

  async function invalidate(tenantId: string, organizationIds: readonly string[]): Promise<void> {
    const tenant = tenantId.toLowerCase()
    const tags = [...canonicalIds(organizationIds).map(organizationCacheTag), XRAY_ANALYTICS_TENANT_WIDE_TAG]
    for (const tag of tags) {
      const key = generationKey(tenant, tag)
      state.generations.set(key, (state.generations.get(key) ?? 0) + 1)
    }
    for (const [key, entry] of Array.from(state.inflight.entries())) {
      if (entry.tenantId === tenant && entry.tags.some((tag) => tags.includes(tag))) state.inflight.delete(key)
    }
    if (!cache) return
    try {
      await runWithCacheTenant(tenant, () => cache.set(XRAY_ANALYTICS_GENERATION_KEY, { token: randomUUID() }, { ttl: XRAY_ANALYTICS_GENERATION_TTL_MS }))
    } catch (error) {
      reportCacheFailure('set_generation', error)
    }
    try {
      await runWithCacheTenant(tenant, () => cache.deleteByTags(tags))
    } catch (error) {
      reportCacheFailure('delete_by_tags', error)
    }
  }

  return { getOrCompute, invalidate }
}
