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
  return enricher.features.every((f) => userFeatures.includes(f))
}

function getActiveEnrichers(
  targetEntity: string,
  userFeatures: string[] | undefined,
): EnricherRegistryEntry[] {
  const entries = getEnrichersForEntity(targetEntity)
  return entries.filter((entry) => hasRequiredFeatures(entry.enricher, userFeatures))
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
  const activeEntries = getActiveEnrichers(targetEntity, context.userFeatures)

  if (activeEntries.length === 0) {
    return { items, _meta: { enrichedBy: [] } }
  }

  const enrichedBy: string[] = []
  const enricherErrors: string[] = []
  let currentItems = items

  for (const entry of activeEntries) {
    const enricher = entry.enricher
    const timeout = enricher.timeout ?? DEFAULT_TIMEOUT
    const startTime = Date.now()

    try {
      let result: T[]

      if (enricher.enrichMany) {
        result = await Promise.race([
          enricher.enrichMany(currentItems, context) as Promise<T[]>,
          timeoutPromise(timeout),
        ])
      } else {
        result = await Promise.race([
          Promise.all(currentItems.map((item) => enricher.enrichOne(item, context))) as Promise<T[]>,
          timeoutPromise(timeout),
        ])
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
  const activeEntries = getActiveEnrichers(targetEntity, context.userFeatures)

  if (activeEntries.length === 0) {
    return { record, _meta: { enrichedBy: [] } }
  }

  const enrichedBy: string[] = []
  const enricherErrors: string[] = []
  let currentRecord = record

  for (const entry of activeEntries) {
    const enricher = entry.enricher
    const timeout = enricher.timeout ?? DEFAULT_TIMEOUT

    try {
      const result = await Promise.race([
        enricher.enrichOne(currentRecord, context) as Promise<T>,
        timeoutPromise(timeout),
      ])

      currentRecord = result
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
