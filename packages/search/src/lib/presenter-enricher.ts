import type { Knex } from 'knex'
import type {
  SearchBuildContext,
  SearchResult,
  SearchResultPresenter,
  SearchResultLink,
  SearchEntityConfig,
  PresenterEnricherFn,
} from '../types'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { decryptIndexDocForSearch } from '@open-mercato/shared/lib/encryption/indexDoc'
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
 * Check if a string looks like an encrypted value.
 * Encrypted format: iv:ciphertext:authTag:v1
 */
function looksEncrypted(value: unknown): boolean {
  if (typeof value !== 'string') return false
  if (!value.includes(':')) return false
  const parts = value.split(':')
  // Encrypted strings end with :v1 and have at least 3 colon-separated parts
  return parts.length >= 3 && parts[parts.length - 1] === 'v1'
}

/**
 * Check if a result needs enrichment (missing presenter, encrypted values, or missing URL/links)
 */
function needsEnrichment(result: SearchResult): boolean {
  if (!result.presenter?.title) return true
  // Also re-enrich if presenter looks encrypted
  if (looksEncrypted(result.presenter.title)) return true
  if (looksEncrypted(result.presenter.subtitle)) return true
  // Also enrich if missing URL/links (needed for token search results)
  if (!result.url && (!result.links || result.links.length === 0)) return true
  return false
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

/** Result type for presenter and links computation */
type EnrichmentResult = {
  presenter: SearchResultPresenter | null
  url?: string
  links?: SearchResultLink[]
}

/**
 * Compute presenter, URL, and links for a single doc using config or fallback.
 * Returns presenter (null if cannot be computed), and optionally URL/links from config.
 */
async function computePresenterAndLinks(
  doc: Record<string, unknown>,
  entityId: string,
  recordId: string,
  config: SearchEntityConfig | undefined,
  tenantId: string,
  organizationId: string | null | undefined,
  queryEngine: QueryEngine | undefined,
): Promise<EnrichmentResult> {
  let presenter: SearchResultPresenter | null = null
  let url: string | undefined
  let links: SearchResultLink[] | undefined

  // Build context for config functions
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

  // If search.ts config exists, use formatResult/buildSource for presenter
  if (config?.formatResult || config?.buildSource) {
    if (config.buildSource) {
      try {
        const source = await config.buildSource(buildContext)
        if (source?.presenter) presenter = source.presenter
        if (source?.links) links = source.links
      } catch (err) {
        logWarning(`buildSource failed for ${entityId}:${recordId}`, { error: String(err) })
      }
    }

    if (!presenter && config.formatResult) {
      try {
        presenter = (await config.formatResult(buildContext)) ?? null
      } catch (err) {
        logWarning(`formatResult failed for ${entityId}:${recordId}`, { error: String(err) })
      }
    }
  }

  // Fallback presenter: extract from doc fields directly
  if (!presenter) {
    presenter = extractFallbackPresenter(doc, entityId, recordId)
  }

  // Resolve URL from config
  if (config?.resolveUrl) {
    try {
      url = (await config.resolveUrl(buildContext)) ?? undefined
    } catch {
      // Skip URL resolution errors
    }
  }

  // Resolve links from config (if not already set from buildSource)
  if (!links && config?.resolveLinks) {
    try {
      links = (await config.resolveLinks(buildContext)) ?? undefined
    } catch {
      // Skip link resolution errors
    }
  }

  return { presenter, url, links }
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
 * - Automatic decryption of encrypted fields when encryption service is provided
 */
export function createPresenterEnricher(
  knex: Knex,
  entityConfigMap: Map<EntityId, SearchEntityConfig>,
  queryEngine?: QueryEngine,
  encryptionService?: TenantDataEncryptionService | null,
): PresenterEnricherFn {
  return async (results, tenantId, organizationId) => {
    // Find results missing presenter OR with encrypted presenter
    const missingResults = results.filter(needsEnrichment)
    if (missingResults.length === 0) return results

    // Group by entity type for config lookup
    const byEntityType = new Map<string, SearchResult[]>()
    for (const result of missingResults) {
      const group = byEntityType.get(result.entityId) ?? []
      group.push(result)
      byEntityType.set(result.entityId, group)
    }

    // Single batch query for all docs across all entity types
    const rawDocs = await fetchDocsBatch(knex, byEntityType, tenantId, organizationId)

    // Decrypt docs in parallel using DEK cache for efficiency
    const dekCache = new Map<string | null, string | null>()

    const decryptedDocs = await Promise.all(
      rawDocs.map(async (row) => {
        try {
          // Use organization_id from the doc itself for proper encryption map lookup
          // This is critical for global search where organizationId param is null
          const docData = row.doc as Record<string, unknown>
          const docOrgId = (docData.organization_id as string | null | undefined) ?? organizationId
          const scope = { tenantId, organizationId: docOrgId }

          const decryptedDoc = await decryptIndexDocForSearch(
            row.entity_type,
            row.doc,
            scope,
            encryptionService ?? null,
            dekCache,
          )
          return { ...row, doc: decryptedDoc }
        } catch (err) {
          logWarning(`Failed to decrypt doc for ${row.entity_type}:${row.entity_id}`, { error: String(err) })
          return row // Return original doc if decryption fails
        }
      }),
    )

    // Build doc lookup map for fast access
    const docMap = new Map<string, Record<string, unknown>>()
    for (const row of decryptedDocs) {
      docMap.set(`${row.entity_type}:${row.entity_id}`, row.doc)
    }

    // Compute presenters and links in parallel
    const enrichmentPromises = missingResults.map(async (result) => {
      const key = `${result.entityId}:${result.recordId}`
      const doc = docMap.get(key)

      if (!doc) {
        logWarning(`Doc not found in entity_indexes`, { entityId: result.entityId, recordId: result.recordId })
        return { key, presenter: null, url: undefined, links: undefined }
      }

      const config = entityConfigMap.get(result.entityId as EntityId)
      const enrichment = await computePresenterAndLinks(
        doc,
        result.entityId,
        result.recordId,
        config,
        tenantId,
        organizationId,
        queryEngine,
      )

      return { key, ...enrichment }
    })

    const computed = await Promise.all(enrichmentPromises)

    // Build enrichment map from parallel results
    const enrichmentMap = new Map<string, EnrichmentResult>()
    for (const { key, presenter, url, links } of computed) {
      enrichmentMap.set(key, { presenter, url, links })
    }

    // Enrich results with computed presenter, URL, and links
    return results.map((result) => {
      if (!needsEnrichment(result)) return result
      const key = `${result.entityId}:${result.recordId}`
      const enriched = enrichmentMap.get(key)
      if (!enriched) return result
      return {
        ...result,
        presenter: enriched.presenter ?? result.presenter,
        url: result.url ?? enriched.url,
        links: result.links ?? enriched.links,
      }
    })
  }
}
