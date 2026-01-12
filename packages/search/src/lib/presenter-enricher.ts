import type { Knex } from 'knex'
import type {
  SearchBuildContext,
  SearchResult,
  SearchResultPresenter,
  SearchEntityConfig,
  PresenterEnricherFn,
} from '../types'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import { extractFallbackPresenter } from './fallback-presenter'

/** Maximum number of record IDs per batch query to avoid hitting DB parameter limits */
const BATCH_SIZE = 500

/** Logger for debugging - uses console.warn to surface issues without breaking flow */
const logWarning = (message: string, context?: Record<string, unknown>) => {
  if (process.env.NODE_ENV === 'development' || process.env.DEBUG_SEARCH_ENRICHER) {
    console.warn(`[search:presenter-enricher] ${message}`, context ?? '')
  }
}

/**
 * Split an array into chunks of specified size.
 */
function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
}

/**
 * Build a single batch query for multiple entity types and their record IDs.
 * Uses OR conditions to fetch all needed docs in one round trip.
 */
async function fetchDocsBatch(
  knex: Knex,
  byEntityType: Map<string, SearchResult[]>,
  tenantId: string,
  organizationId?: string | null,
): Promise<Array<{ entity_type: string; entity_id: string; doc: Record<string, unknown> }>> {
  const allDocs: Array<{ entity_type: string; entity_id: string; doc: Record<string, unknown> }> = []

  // Collect all entity type + record ID pairs
  const allPairs: Array<{ entityType: string; recordId: string }> = []
  for (const [entityType, results] of byEntityType) {
    for (const result of results) {
      allPairs.push({ entityType, recordId: result.recordId })
    }
  }

  if (allPairs.length === 0) return allDocs

  // Process in chunks to avoid hitting DB parameter limits
  const chunks = chunk(allPairs, BATCH_SIZE)

  for (const pairChunk of chunks) {
    // Group by entity type within this chunk for efficient OR query
    const chunkByType = new Map<string, string[]>()
    for (const { entityType, recordId } of pairChunk) {
      const ids = chunkByType.get(entityType) ?? []
      ids.push(recordId)
      chunkByType.set(entityType, ids)
    }

    // Build query with OR conditions per entity type
    const query = knex('entity_indexes')
      .select('entity_type', 'entity_id', 'doc')
      .where('tenant_id', tenantId)
      .whereNull('deleted_at')
      .where((builder) => {
        for (const [entityType, recordIds] of chunkByType) {
          builder.orWhere((sub) => {
            sub.where('entity_type', entityType).whereIn('entity_id', recordIds)
          })
        }
      })

    // Add organization filter if provided
    if (organizationId) {
      query.where((builder) => {
        builder.where('organization_id', organizationId).orWhereNull('organization_id')
      })
    }

    const rows = await query
    allDocs.push(...(rows as typeof allDocs))
  }

  return allDocs
}

/**
 * Compute presenter for a single doc using config or fallback.
 * Returns null if presenter cannot be computed.
 */
async function computePresenter(
  doc: Record<string, unknown>,
  entityId: string,
  recordId: string,
  config: SearchEntityConfig | undefined,
  tenantId: string,
  organizationId: string | null | undefined,
  queryEngine: QueryEngine | undefined,
): Promise<SearchResultPresenter | null> {
  // If search.ts config exists, use formatResult/buildSource
  if (config?.formatResult || config?.buildSource) {
    const customFields: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(doc)) {
      if (key.startsWith('cf:') || key.startsWith('cf_')) {
        customFields[key.slice(3)] = value
      }
    }

    const buildContext: SearchBuildContext = {
      record: doc,
      customFields,
      organizationId,
      tenantId,
      queryEngine,
    }

    if (config.buildSource) {
      try {
        const source = await config.buildSource(buildContext)
        if (source?.presenter) return source.presenter
      } catch (err) {
        logWarning(`buildSource failed for ${entityId}:${recordId}`, { error: String(err) })
      }
    }

    if (config.formatResult) {
      try {
        const presenter = await config.formatResult(buildContext)
        if (presenter) return presenter
      } catch (err) {
        logWarning(`formatResult failed for ${entityId}:${recordId}`, { error: String(err) })
      }
    }
  }

  // Fallback: extract from doc fields directly
  return extractFallbackPresenter(doc, entityId, recordId)
}

/**
 * Create a presenter enricher that loads data from entity_indexes and computes presenter.
 * Uses formatResult from search.ts configs when available, otherwise falls back to extracting
 * common fields like display_name, name, title from the doc.
 *
 * Optimizations:
 * - Single batch DB query for all entity types (instead of one per type)
 * - Parallel Promise.all for formatResult/buildSource calls
 * - Tenant/organization scoping for security
 * - Chunked queries to avoid DB parameter limits
 */
export function createPresenterEnricher(
  knex: Knex,
  entityConfigMap: Map<EntityId, SearchEntityConfig>,
  queryEngine?: QueryEngine,
): PresenterEnricherFn {
  return async (results, tenantId, organizationId) => {
    // Find results missing presenter
    const missingResults = results.filter((r) => !r.presenter?.title)
    if (missingResults.length === 0) return results

    // Group by entity type for config lookup
    const byEntityType = new Map<string, SearchResult[]>()
    for (const result of missingResults) {
      const group = byEntityType.get(result.entityId) ?? []
      group.push(result)
      byEntityType.set(result.entityId, group)
    }

    // Single batch query for all docs across all entity types
    const docs = await fetchDocsBatch(knex, byEntityType, tenantId, organizationId)

    // Build doc lookup map for fast access
    const docMap = new Map<string, Record<string, unknown>>()
    for (const row of docs) {
      docMap.set(`${row.entity_type}:${row.entity_id}`, row.doc)
    }

    // Compute presenters in parallel
    const presenterPromises = missingResults.map(async (result) => {
      const key = `${result.entityId}:${result.recordId}`
      const doc = docMap.get(key)

      if (!doc) {
        logWarning(`Doc not found in entity_indexes`, { entityId: result.entityId, recordId: result.recordId })
        return { key, presenter: null }
      }

      const config = entityConfigMap.get(result.entityId as EntityId)
      const presenter = await computePresenter(
        doc,
        result.entityId,
        result.recordId,
        config,
        tenantId,
        organizationId,
        queryEngine,
      )

      return { key, presenter }
    })

    const computed = await Promise.all(presenterPromises)

    // Build presenter map from parallel results
    const presenterMap = new Map<string, SearchResultPresenter>()
    for (const { key, presenter } of computed) {
      if (presenter) {
        presenterMap.set(key, presenter)
      }
    }

    // Enrich results with computed presenters
    return results.map((result) => {
      if (result.presenter?.title) return result
      const key = `${result.entityId}:${result.recordId}`
      const presenter = presenterMap.get(key)
      return presenter ? { ...result, presenter } : result
    })
  }
}
