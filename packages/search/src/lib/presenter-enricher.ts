import type { Kysely } from 'kysely'
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
import { createLogger } from '@open-mercato/shared/lib/logger'
import { extractFallbackPresenter } from './fallback-presenter'
import { needsSearchResultEnrichment } from './search-result-enrichment'

/** Maximum number of record IDs per batch query to avoid hitting DB parameter limits */
const BATCH_SIZE = 500

/** Diagnostic logger - surfaces issues without breaking flow, gated by OM_LOG_LEVEL=debug */
const enricherLogger = createLogger('search').child({ component: 'presenter-enricher' })
const logWarning = (message: string, context?: Record<string, unknown>) => {
  enricherLogger.debug(message, context)
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
 *
 * The tenant predicate carries the same NULL branch the organization predicate
 * below already has, and for the same reason: a row stored under a null scope is
 * one shared record, not a record belonging to nobody. `entity_indexes` holds at
 * most one row per (entity_type, entity_id, organization_id_coalesced), so a
 * platform-wide catalogue whose source table has neither scope column has exactly
 * one row to serve every tenant from, and an exact-match tenant predicate resolves
 * it for at most one of them; the rest get a search hit with no presenter, which
 * the UI renders as a raw record id.
 *
 * The branch is deliberately NOT `tenant_id IS NULL` on its own. `tenant_id` is
 * null on the projection of every source table with neither scope column —
 * `resolveQueryIndexRecordScope()` calls that shape `global` and requires an
 * explicitly null scope for it — and most of those tables are private
 * (`directory:tenant`, `auth:user_role`, `auth:session`). An unqualified NULL
 * branch would serve all of them to every tenant. Only entity types declared
 * through `registerTenantGlobalEntityTypes()` are widened.
 */
async function fetchDocsBatch(
  db: Kysely<any>,
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

  // Dynamically imported to match the sibling reader in `strategies/token.strategy.ts`
  // and keep this module free of a load-time edge back into `@open-mercato/core`.
  const { isTenantGlobalEntityType } = await import(
    '@open-mercato/core/modules/query_index/lib/tenant-global'
  )

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

    // Entity types in this chunk that are declared platform-wide catalogues, and so
    // may also be served from a row stored under the null tenant.
    const globalEntityTypes = Array.from(chunkByType.keys()).filter(isTenantGlobalEntityType)

    // Build query with OR conditions per entity type
    let query = db
      .selectFrom('entity_indexes' as any)
      .select(['entity_type' as any, 'entity_id' as any, 'doc' as any])
      .where((eb: any) => (globalEntityTypes.length === 0
        ? eb('tenant_id' as any, '=', tenantId)
        : eb.or([
          eb('tenant_id' as any, '=', tenantId),
          eb.and([
            eb('tenant_id' as any, 'is', null),
            eb('entity_type' as any, 'in', globalEntityTypes),
          ]),
        ])))
      .where('deleted_at' as any, 'is', null)
      .where((eb: any) => eb.or(
        Array.from(chunkByType.entries()).map(([entityType, recordIds]) => eb.and([
          eb('entity_type' as any, '=', entityType),
          eb('entity_id' as any, 'in', recordIds),
        ])),
      ))

    // Add organization filter if provided
    if (organizationId) {
      query = query.where((eb: any) => eb.or([
        eb('organization_id' as any, '=', organizationId),
        eb('organization_id' as any, 'is', null),
      ]))
    }

    const rows = await query.execute() as Array<{ entity_type: string; entity_id: string; doc: Record<string, unknown> }>
    allDocs.push(...rows)
  }

  return allDocs
}

/** Result type for presenter and links computation */
type EnrichmentResult = {
  presenter: SearchResultPresenter | null
  url?: string
  links?: SearchResultLink[]
}

function primaryNavigationHref(result: SearchResult): string | null {
  if (typeof result.url === 'string' && result.url.trim().length > 0) {
    return result.url.trim()
  }
  const primaryLink = result.links?.find((link) => link.kind === 'primary' && link.href.trim().length > 0)
  return primaryLink?.href.trim() ?? null
}

function directNavigationRecordId(href: string): string | null {
  try {
    const url = new URL(href, 'http://search.local')
    if (url.search || url.hash) return null
    const segments = url.pathname.split('/').filter(Boolean)
    const lastSegment = segments.at(-1)
    return lastSegment ? decodeURIComponent(lastSegment) : null
  } catch {
    return null
  }
}

function presenterTitle(result: SearchResult): string | null {
  const title = result.presenter?.title?.trim()
  return title?.length ? title : null
}

function resultScopeKey(result: SearchResult, recordId: string): string {
  return `${result.organizationId ?? ''}:${recordId}`
}

function mergeResultMetadata(
  targetMetadata: SearchResult['metadata'],
  linkedMetadata: SearchResult['metadata'],
): SearchResult['metadata'] {
  if (!targetMetadata && !linkedMetadata) return undefined
  return {
    ...targetMetadata,
    ...linkedMetadata,
  }
}

function mergeLinkedDuplicateResults(results: SearchResult[]): SearchResult[] {
  const indexesByRecord = new Map<string, number[]>()
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index]
    const key = resultScopeKey(result, result.recordId)
    const indexes = indexesByRecord.get(key) ?? []
    indexes.push(index)
    indexesByRecord.set(key, indexes)
  }

  const replacements = new Map<number, SearchResult>()
  const removedIndexes = new Set<number>()

  for (let index = 0; index < results.length; index += 1) {
    const linkedResult = results[index]
    const href = primaryNavigationHref(linkedResult)
    const targetRecordId = href ? directNavigationRecordId(href) : null
    if (!targetRecordId || targetRecordId === linkedResult.recordId) continue

    const targetIndexes = (indexesByRecord.get(resultScopeKey(linkedResult, targetRecordId)) ?? [])
      .filter((candidateIndex) => candidateIndex !== index && !removedIndexes.has(candidateIndex))
    if (targetIndexes.length !== 1) continue

    const targetIndex = targetIndexes[0]
    const targetResult = replacements.get(targetIndex) ?? results[targetIndex]
    if (primaryNavigationHref(targetResult)) continue

    const linkedTitle = presenterTitle(linkedResult)
    const targetTitle = presenterTitle(targetResult)
    if (!linkedTitle || linkedTitle !== targetTitle) continue

    replacements.set(targetIndex, {
      ...targetResult,
      score: Math.max(targetResult.score, linkedResult.score),
      source: linkedResult.score > targetResult.score ? linkedResult.source : targetResult.source,
      presenter: linkedResult.presenter ?? targetResult.presenter,
      url: linkedResult.url ?? targetResult.url,
      links: linkedResult.links ?? targetResult.links,
      metadata: mergeResultMetadata(targetResult.metadata, linkedResult.metadata),
    })
    removedIndexes.add(index)
  }

  return results
    .map((result, index) => replacements.get(index) ?? result)
    .filter((_, index) => !removedIndexes.has(index))
    .sort((left, right) => right.score - left.score)
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

  if (config?.formatResult || config?.buildSource) {
    if (config.formatResult) {
      try {
        presenter = (await config.formatResult(buildContext)) ?? null
      } catch (err) {
        logWarning('formatResult failed', { entityId, recordId, err })
      }
    }

    if (!presenter && config.buildSource) {
      try {
        const source = await config.buildSource(buildContext)
        if (source?.presenter) presenter = source.presenter
        if (source?.links) links = source.links
      } catch (err) {
        logWarning('buildSource failed', { entityId, recordId, err })
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
  db: Kysely<any>,
  entityConfigMap: Map<EntityId, SearchEntityConfig>,
  queryEngine?: QueryEngine,
  encryptionService?: TenantDataEncryptionService | null,
): PresenterEnricherFn {
  return async (results, tenantId, organizationId) => {
    const shouldEnrich = (result: SearchResult): boolean =>
      needsSearchResultEnrichment(result) || entityConfigMap.has(result.entityId as EntityId)

    const missingResults = results.filter(shouldEnrich)
    if (missingResults.length === 0) return results

    // Group by entity type for config lookup
    const byEntityType = new Map<string, SearchResult[]>()
    for (const result of missingResults) {
      const group = byEntityType.get(result.entityId) ?? []
      group.push(result)
      byEntityType.set(result.entityId, group)
    }

    // Single batch query for all docs across all entity types
    const rawDocs = await fetchDocsBatch(db, byEntityType, tenantId, organizationId)

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
          logWarning('Failed to decrypt doc', { entityId: row.entity_type, recordId: row.entity_id, err })
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
        logWarning('Doc not found in entity_indexes', { entityId: result.entityId, recordId: result.recordId })
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
    const enrichedResults = results.map((result) => {
      if (!shouldEnrich(result)) return result
      const key = `${result.entityId}:${result.recordId}`
      const enriched = enrichmentMap.get(key)
      if (!enriched) return result
      return {
        ...result,
        presenter: enriched.presenter ?? result.presenter,
        url: result.url ?? enriched.url,
        links: enriched.links ?? result.links,
      }
    })

    return mergeLinkedDuplicateResults(enrichedResults)
  }
}
