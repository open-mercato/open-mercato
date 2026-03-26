/**
 * Response Enricher Registry
 *
 * Global registry for response enrichers using the same globalThis pattern
 * as injection widgets for HMR-safe storage.
 */

import type { EnricherRegistryEntry, EnricherQueryEngineConfig, ResponseEnricher } from './response-enricher'

/**
 * Selector for filtering enrichers by execution surface.
 *
 * - `'api-response'`: returns all enrichers matching the entity (existing behavior).
 * - `'query-engine'`: returns only enrichers with `queryEngine.enabled === true`
 *   and matching the specified engine type.
 */
export interface EnricherSurfaceSelector {
  surface: 'api-response' | 'query-engine'
  engine?: 'basic' | 'hybrid'
}

const GLOBAL_ENRICHERS_KEY = '__openMercatoResponseEnrichers__'

let _enricherEntries: EnricherRegistryEntry[] | null = null

function readGlobalEnrichers(): EnricherRegistryEntry[] | null {
  try {
    const value = (globalThis as Record<string, unknown>)[GLOBAL_ENRICHERS_KEY]
    return Array.isArray(value) ? (value as EnricherRegistryEntry[]) : null
  } catch {
    return null
  }
}

function writeGlobalEnrichers(entries: EnricherRegistryEntry[]) {
  try {
    ;(globalThis as Record<string, unknown>)[GLOBAL_ENRICHERS_KEY] = entries
  } catch {
    // ignore global assignment failures
  }
}

/**
 * Register response enrichers from all modules.
 * Called during bootstrap after generated enrichers are imported.
 */
export function registerResponseEnrichers(
  entries: Array<{ moduleId: string; enrichers: ResponseEnricher[] }>,
) {
  const flat: EnricherRegistryEntry[] = []
  for (const entry of entries) {
    for (const enricher of entry.enrichers) {
      flat.push({ moduleId: entry.moduleId, enricher })
    }
  }
  flat.sort((a, b) => (b.enricher.priority ?? 0) - (a.enricher.priority ?? 0))
  _enricherEntries = flat
  writeGlobalEnrichers(flat)
}

/**
 * Get all registered response enrichers.
 */
export function getResponseEnrichers(): EnricherRegistryEntry[] {
  const globalEntries = readGlobalEnrichers()
  if (globalEntries) return globalEntries
  if (!_enricherEntries) {
    return []
  }
  return _enricherEntries
}

/**
 * Get enrichers targeting a specific entity, sorted by priority (higher first).
 *
 * When `selector` is omitted the function returns all enrichers for the entity
 * (backward compatible with existing callers).
 *
 * When `selector.surface === 'api-response'` — same as omitted (all enrichers).
 * When `selector.surface === 'query-engine'` — returns only enrichers with
 * `queryEngine.enabled === true` and matching `engines` (defaults to both).
 */
export function getEnrichersForEntity(
  targetEntity: string,
  selector?: EnricherSurfaceSelector,
): EnricherRegistryEntry[] {
  const entityEntries = getResponseEnrichers().filter(
    (entry) => entry.enricher.targetEntity === targetEntity,
  )

  if (!selector || selector.surface === 'api-response') {
    return entityEntries
  }

  return entityEntries.filter((entry) => {
    const qeConfig: EnricherQueryEngineConfig | undefined = entry.enricher.queryEngine
    if (!qeConfig || !qeConfig.enabled) return false
    if (selector.engine && qeConfig.engines && qeConfig.engines.length > 0) {
      return qeConfig.engines.includes(selector.engine)
    }
    return true
  })
}
