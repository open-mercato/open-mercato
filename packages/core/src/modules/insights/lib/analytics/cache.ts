import { createHash } from 'node:crypto'
import type { ZodType } from 'zod'
import { runWithCacheTenant, type CacheStrategy } from '@open-mercato/cache'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { AnalyticsViewer } from './types'

const logger = createLogger('insights').child({ component: 'xray-analytics-cache' })

export const XRAY_ANALYTICS_CACHE_VERSION = 'v1'

export const XRAY_ANALYTICS_CACHE_TTL_MS = 120_000

export const XRAY_ANALYTICS_TAG = 'insights:xray:analytics'

export const XRAY_ANALYTICS_TENANT_WIDE_TAG = 'insights:xray:tenant-wide'

export function organizationCacheTag(organizationId: string): string {
  return `insights:xray:org:${organizationId}`
}

/**
 * Tags of a cached result: one per organization it covers, or the tenant-wide tag for an
 * unrestricted reader (any organization's change invalidates it), plus the analytics tag.
 */
export function analyticsCacheTags(organizationIds: readonly string[] | null): string[] {
  const tags = organizationIds === null
    ? [XRAY_ANALYTICS_TENANT_WIDE_TAG]
    : Array.from(new Set(organizationIds)).sort((left, right) => left.localeCompare(right)).map(organizationCacheTag)
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

/** Cache key of one analytics result: tenant, organization filter, permissions, settings, params. */
export function buildAnalyticsCacheKey(input: AnalyticsCacheKeyInput): string {
  const organizationIds = input.organizationIds === null
    ? null
    : Array.from(new Set(input.organizationIds)).sort((left, right) => left.localeCompare(right))
  const digest = sha256(canonicalJson({
    tenantId: input.tenantId,
    organizationIds,
    permissions: input.permissionFingerprint,
    settings: input.settingsFingerprint,
    params: input.params,
  }))
  return `insights:xray:${XRAY_ANALYTICS_CACHE_VERSION}:${input.operation}:${input.tenantId}:${digest}`
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

/**
 * Read-through cache of analytics results over the DI cache service (tenant-scoped through
 * `runWithCacheTenant`, tag invalidation per organization) with single-flight: concurrent
 * identical requests share one computation. A result computed while its tags were
 * invalidated is returned but not stored, and an invalidation detaches in-flight
 * computations so later callers start fresh. Cached values are validated against the result
 * schema; a cache failure degrades to a live computation.
 */
export function createAnalyticsCache(cache: CacheStrategy | null, state: AnalyticsCacheState = sharedAnalyticsCacheState()): AnalyticsCache {
  const generationsOf = (tenantId: string, tags: readonly string[]) => tags.map((tag) => state.generations.get(generationKey(tenantId, tag)) ?? 0)

  async function read<TValue>(entry: CachedComputation<TValue>): Promise<TValue | null> {
    if (!cache) return null
    try {
      const stored = await runWithCacheTenant(entry.tenantId, () => cache.get(entry.key))
      if (stored === null || stored === undefined) return null
      const parsed = entry.schema.safeParse(stored)
      return parsed.success ? parsed.data : null
    } catch (error) {
      reportCacheFailure('get', error)
      return null
    }
  }

  async function write<TValue>(entry: CachedComputation<TValue>, value: TValue): Promise<void> {
    if (!cache) return
    try {
      await runWithCacheTenant(entry.tenantId, () => cache.set(entry.key, structuredClone(value), {
        ttl: entry.ttlMs ?? XRAY_ANALYTICS_CACHE_TTL_MS,
        tags: [...entry.tags],
      }))
    } catch (error) {
      reportCacheFailure('set', error)
    }
  }

  async function getOrCompute<TValue>(entry: CachedComputation<TValue>, compute: () => Promise<TValue>): Promise<TValue> {
    const cached = await read(entry)
    if (cached !== null) return cached
    const running = state.inflight.get(entry.key)
    if (running && running.tenantId === entry.tenantId) return entry.schema.parse(await running.promise)
    const before = generationsOf(entry.tenantId, entry.tags)
    const promise = compute()
    const inflight: InflightEntry = { tenantId: entry.tenantId, tags: entry.tags, promise }
    state.inflight.set(entry.key, inflight)
    try {
      const value = await promise
      const after = generationsOf(entry.tenantId, entry.tags)
      if (state.inflight.get(entry.key) === inflight && before.every((generation, index) => generation === after[index])) {
        await write(entry, value)
      }
      return value
    } finally {
      if (state.inflight.get(entry.key) === inflight) state.inflight.delete(entry.key)
    }
  }

  async function invalidate(tenantId: string, organizationIds: readonly string[]): Promise<void> {
    const tags = [...organizationIds.map(organizationCacheTag), XRAY_ANALYTICS_TENANT_WIDE_TAG]
    for (const tag of tags) {
      const key = generationKey(tenantId, tag)
      state.generations.set(key, (state.generations.get(key) ?? 0) + 1)
    }
    for (const [key, entry] of Array.from(state.inflight.entries())) {
      if (entry.tenantId === tenantId && entry.tags.some((tag) => tags.includes(tag))) state.inflight.delete(key)
    }
    if (!cache) return
    try {
      await runWithCacheTenant(tenantId, () => cache.deleteByTags(tags))
    } catch (error) {
      reportCacheFailure('delete_by_tags', error)
    }
  }

  return { getOrCompute, invalidate }
}
