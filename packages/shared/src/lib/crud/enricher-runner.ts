/**
 * Response Enricher Runner
 *
 * Executes response enrichers against API response payloads.
 * Handles timeout, fallback, ACL feature gating, and error isolation.
 */

import type {
  EnricherContext,
  EnricherRegistryEntry,
  EnrichmentResult,
  ResponseEnricher,
  SingleEnrichmentResult,
} from './response-enricher'
import { getEnrichersForEntity } from './enricher-registry'
import { logEnricherTiming } from '../umes/enricher-timing'
import { createLogger } from '../logger'
import { authorizeFeatures } from '../../security/featurePolicy'

const logger = createLogger('shared').child({ component: 'umes' })

const DEFAULT_TIMEOUT = 2000
const SLOW_WARN_MS = 100
const SLOW_ERROR_MS = 500
const DEFAULT_CACHE_TTL_MS = 60_000

function timeoutPromise(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Enricher timed out after ${ms}ms`)), ms),
  )
}

function hasRequiredFeatures(
  enricher: ResponseEnricher,
  userFeatures: string[] | undefined,
): boolean {
  if (!enricher.features || enricher.features.length === 0) return true
  if (!userFeatures) return false
  return authorizeFeatures(enricher.features, { grantedFeatures: userFeatures })
}

function filterByACLAndTenant(
  entries: EnricherRegistryEntry[],
  context: EnricherContext,
): EnricherRegistryEntry[] {
  return entries.filter((entry) => {
    const enricher = entry.enricher
    if (!hasRequiredFeatures(enricher, context.userFeatures)) return false
    if (enricher.disabledTenantIds?.includes(context.tenantId)) return false
    return true
  })
}

function getActiveEnrichers(
  targetEntity: string,
  context: EnricherContext,
): EnricherRegistryEntry[] {
  const entries = getEnrichersForEntity(targetEntity)
  return filterByACLAndTenant(entries, context)
}

/**
 * Plan describing whether (and how) a CRUD list cache may embed enricher output.
 */
export type ListCacheEnricherPlan = {
  /**
   * Stable signature of the active, cache-embeddable enrichers in registry
   * (priority) order. Included in the CRUD list cache key so a cached enriched
   * payload is only ever served back to a request whose entitlements select the
   * exact same enricher set. Empty string when nothing is embeddable — keeping
   * the cache key identical to the pre-enricher shape for unaffected routes.
   */
  signature: string
  /**
   * True only when there is at least one active enricher for the context AND
   * every active enricher opted into `cacheableOnListHit`. When true, the
   * enriched list payload may be stored in the cache and served on a hit without
   * re-running enrichers. When false, enrichers MUST re-run on every request so
   * the response reflects live data (cross-module reads, wall-clock values, etc.)
   * and no live enrichment is embedded in the shared cache entry.
   */
  skipEnrichersOnCacheHit: boolean
}

/**
 * Resolve, for the given context, whether the CRUD list cache may embed enricher
 * output and the cache-key signature to partition by when it can.
 *
 * The enriched payload is only embeddable (and the cache hit allowed to skip
 * enrichment) when every active enricher is `cacheableOnListHit` — i.e. its
 * output is a pure function of the cached record and invalidated together with
 * it. If any active enricher reads data the list cache does not invalidate on,
 * the route falls back to caching the pre-enrichment payload and re-running
 * enrichers on every request.
 */
export function resolveListCacheEnricherPlan(
  targetEntity: string,
  context: EnricherContext,
): ListCacheEnricherPlan {
  const active = getActiveEnrichers(targetEntity, context)
  if (active.length === 0) return { signature: '', skipEnrichersOnCacheHit: false }
  const allCacheable = active.every((entry) => entry.enricher.cacheableOnListHit === true)
  if (!allCacheable) return { signature: '', skipEnrichersOnCacheHit: false }
  return {
    signature: active.map((entry) => entry.enricher.id).join(','),
    skipEnrichersOnCacheHit: true,
  }
}

type CacheLike = {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown, options?: { ttl?: number; tags?: string[] }) => Promise<unknown>
}

function resolveCache(context: EnricherContext): CacheLike | null {
  const container = context.container as { resolve?: (name: string) => unknown } | undefined
  if (!container?.resolve) return null
  try {
    const cache = container.resolve('cache') as CacheLike
    if (cache && typeof cache.get === 'function' && typeof cache.set === 'function') {
      return cache
    }
  } catch {
    // ignore cache resolution failures
  }
  try {
    const cacheService = container.resolve('cacheService') as CacheLike
    if (cacheService && typeof cacheService.get === 'function' && typeof cacheService.set === 'function') {
      return cacheService
    }
  } catch {
    // ignore cache service resolution failures
  }
  return null
}

function buildCacheKey(
  enricher: ResponseEnricher,
  context: EnricherContext,
  mode: 'one' | 'many',
  recordIds: string[],
): string {
  const sortedIds = [...recordIds].sort((a, b) => a.localeCompare(b))
  return `umes:enricher:${enricher.id}:tenant:${context.tenantId}:org:${context.organizationId}:mode:${mode}:ids:${JSON.stringify(sortedIds)}`
}

const UNKNOWN_RECORD_ID = 'unknown'

function extractRecordId(record: Record<string, unknown>): string {
  const idValue = record.id
  if (typeof idValue === 'string' && idValue.trim().length > 0) return idValue.trim()
  if (typeof idValue === 'number') return String(idValue)
  return UNKNOWN_RECORD_ID
}

function getEnricherCacheTtl(enricher: ResponseEnricher): number {
  const ttl = enricher.cache?.ttl
  if (typeof ttl === 'number' && Number.isFinite(ttl) && ttl > 0) {
    return ttl
  }
  return DEFAULT_CACHE_TTL_MS
}

function getEnricherCacheTags(enricher: ResponseEnricher, context: EnricherContext): string[] {
  const tags = new Set<string>([
    `tenant:${context.tenantId}`,
    `organization:${context.organizationId}`,
    `enricher:${enricher.id}`,
  ])
  for (const tag of enricher.cache?.tags ?? []) {
    if (!tag || tag.trim().length === 0) continue
    tags.add(tag)
  }
  return Array.from(tags)
}

async function readEnricherCache<T>(
  cache: CacheLike | null,
  key: string,
): Promise<T | null> {
  if (!cache) return null
  try {
    const value = await cache.get(key)
    return value == null ? null : (value as T)
  } catch {
    return null
  }
}

async function writeEnricherCache(
  cache: CacheLike | null,
  key: string,
  value: unknown,
  ttl: number,
  tags: string[],
): Promise<void> {
  if (!cache) return
  try {
    await cache.set(key, value, { ttl, tags })
  } catch {
    // ignore cache write failures
  }
}

/**
 * Cached read-through payload: the fields each enricher ADDED, keyed by record id.
 *
 * Caching whole records would replace the freshly-read record with the snapshot
 * taken at write time, so an edit to a base field (a product's name, an order's
 * status) would not surface until the entry expired, and a cached array would
 * also carry — and therefore overwrite — whatever the previous enricher in the
 * chain contributed. The additive delta is a pure function of the enricher, the
 * tenant/organization scope and the record ids, which is exactly what the cache
 * key already encodes, so it is the only part of the result that is safe to reuse.
 */
type EnricherCacheEnvelope = {
  version: 1
  deltas: Record<string, Record<string, unknown>>
}

const ENRICHER_CACHE_VERSION = 1

function isEnricherCacheEnvelope(value: unknown): value is EnricherCacheEnvelope {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { version?: unknown; deltas?: unknown }
  if (candidate.version !== ENRICHER_CACHE_VERSION) return false
  return typeof candidate.deltas === 'object' && candidate.deltas !== null
}

/**
 * The keys an enricher added to a record, or `null` when the enrichment was not
 * purely additive — it changed or dropped a key that was already there. A
 * non-additive enricher is never cached: replaying only its added keys onto a
 * later record would silently lose the change it made to the existing ones.
 */
function computeAdditiveDelta(
  input: Record<string, unknown>,
  output: Record<string, unknown>,
): Record<string, unknown> | null {
  const delta: Record<string, unknown> = {}
  for (const key of Object.keys(input)) {
    if (!Object.prototype.hasOwnProperty.call(output, key)) return null
    if (output[key] !== input[key]) return null
  }
  for (const key of Object.keys(output)) {
    if (Object.prototype.hasOwnProperty.call(input, key)) continue
    delta[key] = output[key]
  }
  return delta
}

/**
 * Build the cacheable envelope for a batch, or `null` when it cannot be built
 * safely — an unusable record id, a duplicate id (the deltas would collide), or
 * a non-additive enrichment. Every failure mode skips the cache write and leaves
 * the enricher running on every request, which is the pre-cache behavior.
 */
function buildCacheEnvelope<T extends Record<string, unknown>>(
  inputs: T[],
  outputs: T[],
): EnricherCacheEnvelope | null {
  if (inputs.length !== outputs.length) return null
  const deltas: Record<string, Record<string, unknown>> = {}
  for (let index = 0; index < inputs.length; index += 1) {
    const recordId = extractRecordId(inputs[index])
    if (recordId === UNKNOWN_RECORD_ID) return null
    if (Object.prototype.hasOwnProperty.call(deltas, recordId)) return null
    const delta = computeAdditiveDelta(inputs[index], outputs[index])
    if (!delta) return null
    deltas[recordId] = delta
  }
  return { version: ENRICHER_CACHE_VERSION, deltas }
}

/**
 * Merge a cached envelope onto freshly-read records. Returns `null` — a miss —
 * when the envelope does not cover every record, so a partially-cached batch
 * re-runs the enricher rather than returning some records unenriched.
 */
function applyCacheEnvelope<T extends Record<string, unknown>>(
  envelope: EnricherCacheEnvelope,
  records: T[],
): T[] | null {
  const merged: T[] = []
  for (const record of records) {
    const recordId = extractRecordId(record)
    if (recordId === UNKNOWN_RECORD_ID) return null
    const delta = envelope.deltas[recordId]
    if (!delta || typeof delta !== 'object') return null
    merged.push({ ...record, ...delta } as T)
  }
  return merged
}

/**
 * Apply response enrichers to a list of records.
 *
 * Runs AFTER CrudHooks.afterList, BEFORE HTTP response serialization.
 * Each enricher runs independently — a failed non-critical enricher is skipped.
 */
export async function applyResponseEnrichers<T extends Record<string, unknown>>(
  items: T[],
  targetEntity: string,
  context: EnricherContext,
  preFilteredEntries?: EnricherRegistryEntry[],
): Promise<EnrichmentResult<T>> {
  const activeEntries = preFilteredEntries
    ? filterByACLAndTenant(preFilteredEntries, context)
    : getActiveEnrichers(targetEntity, context)

  if (activeEntries.length === 0) {
    return { items, _meta: { enrichedBy: [] } }
  }

  const enrichedBy: string[] = []
  const enricherErrors: string[] = []
  let currentItems = items
  const cache = resolveCache(context)

  for (const entry of activeEntries) {
    const enricher = entry.enricher
    const timeout = enricher.timeout ?? DEFAULT_TIMEOUT
    const startTime = Date.now()

    try {
      let result: T[]
      const recordIds = currentItems.map((item) => extractRecordId(item))
      const shouldUseCache = enricher.cache?.strategy === 'read-through'
      const cacheKey = shouldUseCache ? buildCacheKey(enricher, context, 'many', recordIds) : null
      const inputItems = currentItems
      if (shouldUseCache && cacheKey) {
        const cached = await readEnricherCache<unknown>(cache, cacheKey)
        if (isEnricherCacheEnvelope(cached)) {
          const merged = applyCacheEnvelope(cached, inputItems)
          if (merged) {
            currentItems = merged
            enrichedBy.push(enricher.id)
            continue
          }
        }
      }

      if (enricher.enrichMany) {
        result = await Promise.race([
          enricher.enrichMany(currentItems, context) as Promise<T[]>,
          timeoutPromise(timeout),
        ])
      } else {
        throw new Error(
          `Enricher ${enricher.id} must implement enrichMany() for list endpoints`,
        )
      }

      const elapsedMs = Date.now() - startTime
      if (elapsedMs > SLOW_ERROR_MS) {
        logger.error('Enricher exceeded slow threshold', { enricherId: enricher.id, elapsedMs, thresholdMs: SLOW_ERROR_MS })
      } else if (elapsedMs > SLOW_WARN_MS) {
        logger.warn('Enricher exceeded slow threshold', { enricherId: enricher.id, elapsedMs, thresholdMs: SLOW_WARN_MS })
      }
      logEnricherTiming(enricher.id, entry.moduleId, targetEntity, elapsedMs)

      currentItems = result
      if (shouldUseCache && cacheKey) {
        const envelope = buildCacheEnvelope(inputItems, result)
        if (envelope) {
          await writeEnricherCache(
            cache,
            cacheKey,
            envelope,
            getEnricherCacheTtl(enricher),
            getEnricherCacheTags(enricher, context),
          )
        }
      }
      enrichedBy.push(enricher.id)
    } catch (err) {
      if (enricher.critical) {
        throw err
      }

      logger.warn('Enricher failed', { enricherId: enricher.id, err })
      enricherErrors.push(enricher.id)

      if (enricher.fallback) {
        currentItems = currentItems.map((item) => ({
          ...item,
          ...enricher.fallback,
        })) as T[]
      }
    }
  }

  return {
    items: currentItems,
    _meta: {
      enrichedBy,
      ...(enricherErrors.length > 0 ? { enricherErrors } : {}),
    },
  }
}

/**
 * Apply response enrichers to a single record.
 *
 * Used for detail endpoints (GET /:id), POST, and PUT responses.
 */
export async function applyResponseEnricherToRecord<T extends Record<string, unknown>>(
  record: T,
  targetEntity: string,
  context: EnricherContext,
  preFilteredEntries?: EnricherRegistryEntry[],
): Promise<SingleEnrichmentResult<T>> {
  const activeEntries = preFilteredEntries
    ? filterByACLAndTenant(preFilteredEntries, context)
    : getActiveEnrichers(targetEntity, context)

  if (activeEntries.length === 0) {
    return { record, _meta: { enrichedBy: [] } }
  }

  const enrichedBy: string[] = []
  const enricherErrors: string[] = []
  let currentRecord = record
  const cache = resolveCache(context)

  for (const entry of activeEntries) {
    const enricher = entry.enricher
    const timeout = enricher.timeout ?? DEFAULT_TIMEOUT
    const startTime = Date.now()

    try {
      const recordId = extractRecordId(currentRecord)
      const shouldUseCache = enricher.cache?.strategy === 'read-through'
      const cacheKey = shouldUseCache ? buildCacheKey(enricher, context, 'one', [recordId]) : null
      const inputRecord = currentRecord
      if (shouldUseCache && cacheKey) {
        const cached = await readEnricherCache<unknown>(cache, cacheKey)
        if (isEnricherCacheEnvelope(cached)) {
          const merged = applyCacheEnvelope(cached, [inputRecord])
          if (merged) {
            currentRecord = merged[0]
            enrichedBy.push(enricher.id)
            continue
          }
        }
      }
      const result = await Promise.race([
        enricher.enrichOne(currentRecord, context) as Promise<T>,
        timeoutPromise(timeout),
      ])

      const elapsedMs = Date.now() - startTime
      logEnricherTiming(enricher.id, entry.moduleId, targetEntity, elapsedMs)

      currentRecord = result
      if (shouldUseCache && cacheKey) {
        const envelope = buildCacheEnvelope([inputRecord], [result])
        if (envelope) {
          await writeEnricherCache(
            cache,
            cacheKey,
            envelope,
            getEnricherCacheTtl(enricher),
            getEnricherCacheTags(enricher, context),
          )
        }
      }
      enrichedBy.push(enricher.id)
    } catch (err) {
      if (enricher.critical) {
        throw err
      }

      logger.warn('Enricher failed', { enricherId: enricher.id, err })
      enricherErrors.push(enricher.id)

      if (enricher.fallback) {
        currentRecord = { ...currentRecord, ...enricher.fallback } as T
      }
    }
  }

  return {
    record: currentRecord,
    _meta: {
      enrichedBy,
      ...(enricherErrors.length > 0 ? { enricherErrors } : {}),
    },
  }
}
