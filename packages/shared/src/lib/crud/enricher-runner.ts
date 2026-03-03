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
  const hasFeature = (required: string): boolean => {
    for (const granted of userFeatures) {
      if (granted === '*' || granted === required) return true
      if (granted.endsWith('.*')) {
        const prefix = granted.slice(0, -1)
        if (required.startsWith(prefix)) return true
      }
    }
    return false
  }
  return enricher.features.every((feature) => hasFeature(feature))
}

function getActiveEnrichers(
  targetEntity: string,
  context: EnricherContext,
): EnricherRegistryEntry[] {
  const entries = getEnrichersForEntity(targetEntity)
  return entries.filter((entry) => {
    const enricher = entry.enricher
    if (!hasRequiredFeatures(enricher, context.userFeatures)) return false
    if (enricher.disabledTenantIds?.includes(context.tenantId)) return false
    return true
  })
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
  const sortedIds = [...recordIds].sort()
  return `umes:enricher:${enricher.id}:tenant:${context.tenantId}:org:${context.organizationId}:mode:${mode}:ids:${JSON.stringify(sortedIds)}`
}

function extractRecordId(record: Record<string, unknown>): string {
  const idValue = record.id
  if (typeof idValue === 'string' && idValue.trim().length > 0) return idValue.trim()
  if (typeof idValue === 'number') return String(idValue)
  return 'unknown'
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
 * Apply response enrichers to a list of records.
 *
 * Runs AFTER CrudHooks.afterList, BEFORE HTTP response serialization.
 * Each enricher runs independently — a failed non-critical enricher is skipped.
 */
export async function applyResponseEnrichers<T extends Record<string, unknown>>(
  items: T[],
  targetEntity: string,
  context: EnricherContext,
): Promise<EnrichmentResult<T>> {
  const activeEntries = getActiveEnrichers(targetEntity, context)

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
      if (shouldUseCache && cacheKey) {
        const cached = await readEnricherCache<T[]>(cache, cacheKey)
        if (cached) {
          currentItems = cached
          enrichedBy.push(enricher.id)
          continue
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
        console.error(
          `[UMES] Enricher ${enricher.id} took ${elapsedMs}ms (threshold: ${SLOW_ERROR_MS}ms)`,
        )
      } else if (elapsedMs > SLOW_WARN_MS) {
        console.warn(
          `[UMES] Enricher ${enricher.id} took ${elapsedMs}ms (threshold: ${SLOW_WARN_MS}ms)`,
        )
      }

      currentItems = result
      if (shouldUseCache && cacheKey) {
        await writeEnricherCache(
          cache,
          cacheKey,
          result,
          getEnricherCacheTtl(enricher),
          getEnricherCacheTags(enricher, context),
        )
      }
      enrichedBy.push(enricher.id)
    } catch (err) {
      if (enricher.critical) {
        throw err
      }

      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[UMES] Enricher ${enricher.id} failed: ${message}`)
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
): Promise<SingleEnrichmentResult<T>> {
  const activeEntries = getActiveEnrichers(targetEntity, context)

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

    try {
      const recordId = extractRecordId(currentRecord)
      const shouldUseCache = enricher.cache?.strategy === 'read-through'
      const cacheKey = shouldUseCache ? buildCacheKey(enricher, context, 'one', [recordId]) : null
      if (shouldUseCache && cacheKey) {
        const cached = await readEnricherCache<T>(cache, cacheKey)
        if (cached) {
          currentRecord = cached
          enrichedBy.push(enricher.id)
          continue
        }
      }
      const result = await Promise.race([
        enricher.enrichOne(currentRecord, context) as Promise<T>,
        timeoutPromise(timeout),
      ])

      currentRecord = result
      if (shouldUseCache && cacheKey) {
        await writeEnricherCache(
          cache,
          cacheKey,
          result,
          getEnricherCacheTtl(enricher),
          getEnricherCacheTags(enricher, context),
        )
      }
      enrichedBy.push(enricher.id)
    } catch (err) {
      if (enricher.critical) {
        throw err
      }

      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[UMES] Enricher ${enricher.id} failed: ${message}`)
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
