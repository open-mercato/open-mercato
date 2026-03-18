import type { SearchService } from '../service'
import type {
  SearchModuleConfig,
  SearchEntityConfig,
  SearchBuildContext,
  IndexableRecord,
  SearchResultPresenter,
  SearchResultLink,
} from '../types'
import type { FullTextSearchStrategy } from '../strategies/fulltext.strategy'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { Queue } from '@open-mercato/queue'
import type { FulltextIndexJobPayload } from '../queue/fulltext-indexing'
import type { VectorIndexJobPayload, VectorBatchRecord } from '../queue/vector-indexing'
import { searchDebug, searchDebugWarn, searchError } from '../lib/debug'

/**
 * Maximum number of pages to process during reindex to prevent infinite loops.
 * At 50 records per page, this allows up to 500,000 records per entity.
 */
const MAX_PAGES = 10000

/**
 * Parameters for indexing a record.
 */
export type IndexRecordParams = {
  entityId: EntityId
  recordId: string
  tenantId: string
  organizationId?: string | null
  record: Record<string, unknown>
  customFields?: Record<string, unknown>
}

/**
 * Parameters for deleting a record from the search index.
 */
export type DeleteRecordParams = {
  entityId: EntityId
  recordId: string
  tenantId: string
}

/**
 * Parameters for purging all records of an entity type.
 */
export type PurgeEntityParams = {
  entityId: EntityId
  tenantId: string
}

/**
 * Parameters for reindexing an entity to fulltext search.
 */
export type ReindexEntityParams = {
  entityId: EntityId
  tenantId: string
  organizationId?: string | null
  /** Whether to recreate the index first (default: true) */
  recreateIndex?: boolean
  /** Callback for progress tracking */
  onProgress?: (progress: ReindexProgress) => void
  /** Whether to use queue for batch processing (default: false) */
  useQueue?: boolean
}

/**
 * Parameters for reindexing all entities to fulltext search.
 */
export type ReindexAllParams = {
  tenantId: string
  organizationId?: string | null
  /** Whether to recreate the index first (default: true) */
  recreateIndex?: boolean
  /** Callback for progress tracking */
  onProgress?: (progress: ReindexProgress) => void
  /** Whether to use queue for batch processing (default: false) */
  useQueue?: boolean
}

/**
 * Progress information during reindex.
 */
export type ReindexProgress = {
  entityId: EntityId
  phase: 'starting' | 'fetching' | 'indexing' | 'complete'
  processed: number
  total?: number
}

/**
 * Result of a reindex operation.
 */
export type ReindexResult = {
  success: boolean
  entitiesProcessed: number
  recordsIndexed: number
  /** Number of records dropped due to missing id or other validation failures */
  recordsDropped?: number
  /** Number of jobs enqueued (when useQueue is true) */
  jobsEnqueued?: number
  errors: Array<{ entityId: EntityId; error: string }>
}

/**
 * Optional dependencies for SearchIndexer.
 */
export type SearchIndexerOptions = {
  queryEngine?: QueryEngine
  /** Queue for fulltext batch indexing */
  fulltextQueue?: Queue<FulltextIndexJobPayload>
  /** Queue for vector batch indexing */
  vectorQueue?: Queue<VectorIndexJobPayload>
}

/**
 * SearchIndexer orchestrates indexing operations by resolving entity configs
 * and building IndexableRecords for the SearchService.
 */
export class SearchIndexer {
  private readonly entityConfigMap: Map<EntityId, SearchEntityConfig>
  private readonly queryEngine?: QueryEngine
  private readonly fulltextQueue?: Queue<FulltextIndexJobPayload>
  private readonly vectorQueue?: Queue<VectorIndexJobPayload>

  constructor(
    private readonly searchService: SearchService,
    private readonly moduleConfigs: SearchModuleConfig[],
    options?: SearchIndexerOptions,
  ) {
    this.entityConfigMap = new Map()
    this.queryEngine = options?.queryEngine
    this.fulltextQueue = options?.fulltextQueue
    this.vectorQueue = options?.vectorQueue
    for (const moduleConfig of moduleConfigs) {
      for (const entityConfig of moduleConfig.entities) {
        if (entityConfig.enabled !== false) {
          this.entityConfigMap.set(entityConfig.entityId as EntityId, entityConfig)
        }
      }
    }
  }

  /**
   * Returns a wrapped QueryEngine that forces skipAutoReindex: true on every query.
   * Used to prevent feedback loops when search indexing callbacks (buildSource, formatResult)
   * call queryEngine.query() to hydrate related entities.
   */
  private get noReindexQueryEngine(): QueryEngine | undefined {
    if (!this.queryEngine) return undefined
    const wrapped: QueryEngine = {
      query: (entity, opts) => this.queryEngine!.query(entity, { ...opts, skipAutoReindex: true }),
    }
    return wrapped
  }

  /**
   * Get the entity config for a given entity ID.
   */
  getEntityConfig(entityId: EntityId): SearchEntityConfig | undefined {
    return this.entityConfigMap.get(entityId)
  }

  /**
   * Get all configured entity configs.
   */
  getAllEntityConfigs(): SearchEntityConfig[] {
    return Array.from(this.entityConfigMap.values())
  }

  /**
   * Check if an entity is configured for search indexing.
   */
  isEntityEnabled(entityId: EntityId): boolean {
    const config = this.entityConfigMap.get(entityId)
    return config?.enabled !== false
  }

  /**
   * Index a record in the search service.
   */
  async indexRecord(params: IndexRecordParams): Promise<void> {
    const config = this.entityConfigMap.get(params.entityId)
    if (!config || config.enabled === false) {
      return // Entity not configured for search
    }

    const buildContext: SearchBuildContext = {
      record: params.record,
      customFields: params.customFields ?? {},
      organizationId: params.organizationId,
      tenantId: params.tenantId,
      queryEngine: this.noReindexQueryEngine,
    }

    // Try buildSource first (provides text, presenter, links, checksumSource)
    let text: string | string[] | undefined
    let presenter: SearchResultPresenter | undefined
    let url: string | undefined
    let links: SearchResultLink[] | undefined
    let checksumSource: unknown | undefined

    if (config.buildSource) {
      try {
        const source = await config.buildSource(buildContext)
        if (source) {
          text = source.text
          if (source.presenter) presenter = source.presenter
          if (source.links) links = source.links
          if (source.checksumSource !== undefined) checksumSource = source.checksumSource
        }
      } catch (error) {
        searchDebugWarn('SearchIndexer', 'buildSource failed', {
          entityId: params.entityId,
          recordId: params.recordId,
          error: error instanceof Error ? error.message : error,
        })
      }
    }

    // Fall back to formatResult if no presenter from buildSource
    if (!presenter && config.formatResult) {
      try {
        const result = await config.formatResult(buildContext)
        if (result) presenter = result
      } catch (error) {
        searchDebugWarn('SearchIndexer', 'formatResult failed', {
          entityId: params.entityId,
          recordId: params.recordId,
          error: error instanceof Error ? error.message : error,
        })
      }
    }

    // Resolve URL if not already set
    if (!url && config.resolveUrl) {
      try {
        const result = await config.resolveUrl(buildContext)
        if (result) url = result
      } catch (error) {
        searchDebugWarn('SearchIndexer', 'resolveUrl failed', {
          entityId: params.entityId,
          recordId: params.recordId,
          error: error instanceof Error ? error.message : error,
        })
      }
    }

    // Resolve links if not already set
    if (!links && config.resolveLinks) {
      try {
        const result = await config.resolveLinks(buildContext)
        if (result) links = result
      } catch (error) {
        searchDebugWarn('SearchIndexer', 'resolveLinks failed', {
          entityId: params.entityId,
          recordId: params.recordId,
          error: error instanceof Error ? error.message : error,
        })
      }
    }

    // Build IndexableRecord
    const indexableRecord: IndexableRecord = {
      entityId: params.entityId,
      recordId: params.recordId,
      tenantId: params.tenantId,
      organizationId: params.organizationId,
      fields: params.record,
      presenter,
      url,
      links,
      text,
      checksumSource,
    }

    await this.searchService.index(indexableRecord)
  }

  /**
   * Index a record by ID (loads the record from database first).
   * Used by workers that only have record identifiers.
   */
  async indexRecordById(params: {
    entityId: EntityId
    recordId: string
    tenantId: string
    organizationId?: string | null
  }): Promise<{ action: 'indexed' | 'skipped'; reason?: string }> {
    if (!this.queryEngine) {
      return { action: 'skipped', reason: 'queryEngine not available' }
    }

    const config = this.entityConfigMap.get(params.entityId)
    if (!config || config.enabled === false) {
      return { action: 'skipped', reason: 'entity not configured' }
    }

    // Load record from database
    try {
      const result = await this.queryEngine.query(params.entityId, {
        tenantId: params.tenantId,
        organizationId: params.organizationId ?? undefined,
        filters: { id: params.recordId },
        includeCustomFields: true,
        page: { page: 1, pageSize: 1 },
        skipAutoReindex: true,
      })

      const record = result.items[0] as Record<string, unknown> | undefined
      if (!record) {
        return { action: 'skipped', reason: 'record not found' }
      }

      // Extract custom fields
      const customFields: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(record)) {
        if (key.startsWith('cf:') || key.startsWith('cf_')) {
          customFields[key.slice(3)] = value
        }
      }

      await this.indexRecord({
        entityId: params.entityId,
        recordId: params.recordId,
        tenantId: params.tenantId,
        organizationId: params.organizationId,
        record,
        customFields,
      })

      return { action: 'indexed' }
    } catch (error) {
      searchError('SearchIndexer', 'Failed to load record for indexing', {
        entityId: params.entityId,
        recordId: params.recordId,
        error: error instanceof Error ? error.message : error,
      })
      throw error
    }
  }

  /**
   * Delete a record from the search index.
   */
  async deleteRecord(params: DeleteRecordParams): Promise<void> {
    await this.searchService.delete(params.entityId, params.recordId, params.tenantId)
  }

  /**
   * Purge all records of an entity type from the search index.
   */
  async purgeEntity(params: PurgeEntityParams): Promise<void> {
    await this.searchService.purge(params.entityId, params.tenantId)
  }

  /**
   * Reindex an entity via all configured strategies (including vector).
   * This is the general reindex method that works with all search strategies.
   */
  async reindexEntity(params: {
    entityId: EntityId
    tenantId: string
    organizationId?: string | null
    purgeFirst?: boolean
  }): Promise<ReindexResult> {
    if (!this.queryEngine) {
      return {
        success: false,
        entitiesProcessed: 0,
        recordsIndexed: 0,
        errors: [{ entityId: params.entityId, error: 'Query engine not available' }],
      }
    }

    const config = this.entityConfigMap.get(params.entityId)
    if (!config || config.enabled === false) {
      return {
        success: false,
        entitiesProcessed: 0,
        recordsIndexed: 0,
        errors: [{ entityId: params.entityId, error: 'Entity not configured for search' }],
      }
    }

    const result: ReindexResult = {
      success: true,
      entitiesProcessed: 1,
      recordsIndexed: 0,
      errors: [],
    }

    // Optionally purge first
    if (params.purgeFirst) {
      try {
        await this.searchService.purge(params.entityId, params.tenantId)
      } catch (error) {
        searchDebugWarn('SearchIndexer', 'Failed to purge entity before reindex', {
          entityId: params.entityId,
          error: error instanceof Error ? error.message : error,
        })
      }
    }

    // Paginate through all records
    let page = 1
    const pageSize = 200
    let hasMore = true

    while (hasMore && page <= MAX_PAGES) {
      try {
        const queryResult = await this.queryEngine.query(params.entityId, {
          tenantId: params.tenantId,
          organizationId: params.organizationId ?? undefined,
          includeCustomFields: true,
          page: { page, pageSize },
          skipAutoReindex: true,
        })

        const items = queryResult.items as Record<string, unknown>[]
        if (items.length === 0) {
          hasMore = false
          break
        }

        // Build and index records
        const { records } = await this.buildIndexableRecords(
          params.entityId,
          params.tenantId,
          params.organizationId ?? null,
          items,
          config,
        )

        // Index each record via SearchService (sends to all strategies)
        for (const record of records) {
          try {
            await this.searchService.index(record)
            result.recordsIndexed++
          } catch (error) {
            searchDebugWarn('SearchIndexer', 'Failed to index record', {
              entityId: params.entityId,
              recordId: record.recordId,
              error: error instanceof Error ? error.message : error,
            })
          }
        }

        page++
        hasMore = items.length === pageSize
      } catch (error) {
        result.success = false
        result.errors.push({
          entityId: params.entityId,
          error: error instanceof Error ? error.message : String(error),
        })
        break
      }
    }

    return result
  }

  /**
   * Reindex all enabled entities via all configured strategies.
   */
  async reindexAll(params: {
    tenantId: string
    organizationId?: string | null
    purgeFirst?: boolean
  }): Promise<ReindexResult> {
    const result: ReindexResult = {
      success: true,
      entitiesProcessed: 0,
      recordsIndexed: 0,
      errors: [],
    }

    const enabledEntities = this.listEnabledEntities()

    for (const entityId of enabledEntities) {
      const entityResult = await this.reindexEntity({
        entityId,
        tenantId: params.tenantId,
        organizationId: params.organizationId,
        purgeFirst: params.purgeFirst,
      })

      result.entitiesProcessed++
      result.recordsIndexed += entityResult.recordsIndexed
      result.errors.push(...entityResult.errors)

      if (!entityResult.success) {
        result.success = false
      }
    }

    return result
  }

  /**
   * Bulk index multiple records.
   */
  async bulkIndexRecords(params: IndexRecordParams[]): Promise<void> {
    const indexableRecords: IndexableRecord[] = []

    for (const param of params) {
      const config = this.entityConfigMap.get(param.entityId)
      if (!config || config.enabled === false) {
        continue
      }

      const buildContext: SearchBuildContext = {
        record: param.record,
        customFields: param.customFields ?? {},
        organizationId: param.organizationId,
        tenantId: param.tenantId,
      }

      let presenter: SearchResultPresenter | undefined
      if (config.formatResult) {
        try {
          const result = await config.formatResult(buildContext)
          if (result) presenter = result
        } catch {
          // Skip presenter on error
        }
      }

      let url: string | undefined
      if (config.resolveUrl) {
        try {
          const result = await config.resolveUrl(buildContext)
          if (result) url = result
        } catch {
          // Skip URL on error
        }
      }

      let links: SearchResultLink[] | undefined
      if (config.resolveLinks) {
        try {
          const result = await config.resolveLinks(buildContext)
          if (result) links = result
        } catch {
          // Skip links on error
        }
      }

      indexableRecords.push({
        entityId: param.entityId,
        recordId: param.recordId,
        tenantId: param.tenantId,
        organizationId: param.organizationId,
        fields: param.record,
        presenter,
        url,
        links,
      })
    }

    if (indexableRecords.length > 0) {
      await this.searchService.bulkIndex(indexableRecords)
    }
  }

  /**
   * List all enabled entity IDs from the module configurations.
   */
  listEnabledEntities(): EntityId[] {
    return Array.from(this.entityConfigMap.keys())
  }

  /**
   * Get the fulltext strategy from the search service.
   */
  private getFulltextStrategy(): FullTextSearchStrategy | undefined {
    const strategy = this.searchService.getStrategy('fulltext')
    if (!strategy) return undefined
    return strategy as FullTextSearchStrategy
  }

  /**
   * Reindex a single entity type to fulltext search.
   * This fetches all records from the database and re-indexes them to fulltext only.
   *
   * When `useQueue` is true, batches are enqueued for background processing by workers.
   * When `useQueue` is false (default), batches are indexed directly (blocking).
   */
  async reindexEntityToFulltext(params: ReindexEntityParams): Promise<ReindexResult> {
    const result: ReindexResult = {
      success: true,
      entitiesProcessed: 0,
      recordsIndexed: 0,
      recordsDropped: 0,
      jobsEnqueued: 0,
      errors: [],
    }

    const fulltext = this.getFulltextStrategy()
    if (!fulltext) {
      result.success = false
      result.errors.push({ entityId: params.entityId, error: 'Fulltext strategy not available' })
      return result
    }

    // If useQueue is requested but no queue is available, return error
    if (params.useQueue && !this.fulltextQueue) {
      result.success = false
      result.errors.push({ entityId: params.entityId, error: 'Fulltext queue not configured for queue-based reindexing' })
      return result
    }

    if (!this.queryEngine) {
      result.success = false
      result.errors.push({ entityId: params.entityId, error: 'QueryEngine not available for reindexing' })
      return result
    }

    const config = this.entityConfigMap.get(params.entityId)
    if (!config) {
      result.success = false
      result.errors.push({ entityId: params.entityId, error: 'Entity not configured for search' })
      return result
    }

    try {
      params.onProgress?.({
        entityId: params.entityId,
        phase: 'starting',
        processed: 0,
      })

      // Recreate index if requested (default: true)
      if (params.recreateIndex !== false) {
        await fulltext.recreateIndex(params.tenantId)
      }

      // Fetch and index records with pagination
      const pageSize = 200
      let page = 1
      let totalProcessed = 0
      let jobsEnqueued = 0

      for (;;) {
        params.onProgress?.({
          entityId: params.entityId,
          phase: 'fetching',
          processed: totalProcessed,
        })

        try {
          const queryResult = await this.queryEngine.query(params.entityId, {
            tenantId: params.tenantId,
            organizationId: params.organizationId ?? undefined,
            page: { page, pageSize },
            skipAutoReindex: true,
          })

          if (!queryResult.items.length) {
            break
          }

        params.onProgress?.({
          entityId: params.entityId,
          phase: 'indexing',
          processed: totalProcessed,
          total: queryResult.total,
        })

        // Build IndexableRecords for this batch
          const { records: indexableRecords, dropped } = await this.buildIndexableRecords(
            params.entityId,
            params.tenantId,
            params.organizationId ?? null,
            queryResult.items,
            config,
          )
          result.recordsDropped = (result.recordsDropped ?? 0) + dropped

          // Index to fulltext - either via queue or directly
          if (indexableRecords.length > 0) {
            if (params.useQueue && this.fulltextQueue) {
              // Enqueue batch for background processing - only pass minimal references
              // Worker will load fresh data from entity_indexes table
              await this.fulltextQueue.enqueue({
                jobType: 'batch-index',
                tenantId: params.tenantId,
                organizationId: params.organizationId,
                records: indexableRecords.map((r) => ({ entityId: r.entityId, recordId: r.recordId })),
              })
              jobsEnqueued += 1
              totalProcessed += indexableRecords.length
            } else {
              // Direct indexing (blocking)
              try {
                await fulltext.bulkIndex(indexableRecords)
                totalProcessed += indexableRecords.length
              } catch (indexError) {
                // Log error but continue with remaining batches
                const errorMsg = indexError instanceof Error ? indexError.message : String(indexError)
                result.errors.push({
                  entityId: params.entityId,
                  error: `Batch ${page} failed: ${errorMsg}`,
                })
              }
            }
          }

          if (queryResult.items.length < pageSize) {
            break
          }
          page += 1

          // Safety check to prevent infinite loops
          if (page > MAX_PAGES) {
            break
          }
        } catch (queryError) {
          const errorMsg = queryError instanceof Error ? queryError.message : String(queryError)
          result.errors.push({
            entityId: params.entityId,
            error: `Query failed: ${errorMsg}`,
          })
          break
        }
      }

      result.entitiesProcessed = 1
      result.recordsIndexed = totalProcessed
      result.jobsEnqueued = jobsEnqueued

      params.onProgress?.({
        entityId: params.entityId,
        phase: 'complete',
        processed: totalProcessed,
        total: totalProcessed,
      })
    } catch (error) {
      result.success = false
      result.errors.push({
        entityId: params.entityId,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    return result
  }

  /**
   * Reindex all enabled entities to fulltext search.
   *
   * When `useQueue` is true, batches are enqueued for background processing by workers.
   * When `useQueue` is false (default), batches are indexed directly (blocking).
   */
  async reindexAllToFulltext(params: ReindexAllParams): Promise<ReindexResult> {
    const result: ReindexResult = {
      success: true,
      entitiesProcessed: 0,
      recordsIndexed: 0,
      recordsDropped: 0,
      jobsEnqueued: 0,
      errors: [],
    }

    const fulltext = this.getFulltextStrategy()
    if (!fulltext) {
      result.success = false
      result.errors.push({ entityId: 'all' as EntityId, error: 'Fulltext strategy not available' })
      return result
    }

    // Recreate index once before processing all entities
    if (params.recreateIndex !== false) {
      await fulltext.recreateIndex(params.tenantId)
    }

    const entities = this.listEnabledEntities()

    for (const entityId of entities) {
      const entityResult = await this.reindexEntityToFulltext({
        entityId,
        tenantId: params.tenantId,
        organizationId: params.organizationId,
        recreateIndex: false, // Already recreated above
        onProgress: params.onProgress,
        useQueue: params.useQueue,
      })

      result.entitiesProcessed += entityResult.entitiesProcessed
      result.recordsIndexed += entityResult.recordsIndexed
      result.recordsDropped = (result.recordsDropped ?? 0) + (entityResult.recordsDropped ?? 0)
      result.jobsEnqueued = (result.jobsEnqueued ?? 0) + (entityResult.jobsEnqueued ?? 0)
      result.errors.push(...entityResult.errors)

      if (!entityResult.success) {
        result.success = false
      }
    }

    return result
  }

  /**
   * Reindex a single entity type to vector search.
   * This fetches all records from the database and enqueues them for vector indexing.
   *
   * When `useQueue` is true (default), record IDs are enqueued for background processing by workers.
   * When `useQueue` is false, records are indexed directly (blocking).
   */
  async reindexEntityToVector(params: ReindexEntityParams & { purgeFirst?: boolean }): Promise<ReindexResult> {
    searchDebug('SearchIndexer', 'reindexEntityToVector called', {
      entityId: params.entityId,
      tenantId: params.tenantId,
      organizationId: params.organizationId,
      useQueue: params.useQueue,
      purgeFirst: params.purgeFirst,
    })

    const result: ReindexResult = {
      success: true,
      entitiesProcessed: 0,
      recordsIndexed: 0,
      recordsDropped: 0,
      jobsEnqueued: 0,
      errors: [],
    }

    // If useQueue is requested but no queue is available, return error
    if (params.useQueue !== false && !this.vectorQueue) {
      result.success = false
      result.errors.push({ entityId: params.entityId, error: 'Vector queue not configured for queue-based reindexing' })
      return result
    }

    if (!this.queryEngine) {
      result.success = false
      result.errors.push({ entityId: params.entityId, error: 'QueryEngine not available for reindexing' })
      return result
    }

    const config = this.entityConfigMap.get(params.entityId)
    if (!config) {
      result.success = false
      result.errors.push({ entityId: params.entityId, error: 'Entity not configured for search' })
      return result
    }

    try {
      params.onProgress?.({
        entityId: params.entityId,
        phase: 'starting',
        processed: 0,
      })

      // Optionally purge vector index first
      if (params.purgeFirst) {
        try {
          await this.searchService.purge(params.entityId, params.tenantId)
        } catch (error) {
          searchDebugWarn('SearchIndexer', 'Failed to purge entity before vector reindex', {
            entityId: params.entityId,
            error: error instanceof Error ? error.message : error,
          })
        }
      }

      // Fetch and enqueue records with pagination
      const pageSize = 200
      let page = 1
      let totalProcessed = 0
      let jobsEnqueued = 0

      for (;;) {
        params.onProgress?.({
          entityId: params.entityId,
          phase: 'fetching',
          processed: totalProcessed,
        })

        const queryResult = await this.queryEngine.query(params.entityId, {
          tenantId: params.tenantId,
          organizationId: params.organizationId ?? undefined,
          page: { page, pageSize },
          skipAutoReindex: true,
        })

        if (!queryResult.items.length) break

        params.onProgress?.({
          entityId: params.entityId,
          phase: 'indexing',
          processed: totalProcessed,
          total: queryResult.total,
        })

        // Build batch of record references
        const batchRecords: VectorBatchRecord[] = []
        for (const item of queryResult.items) {
          const recordId = String((item as Record<string, unknown>).id ?? '')
          if (!recordId) {
            result.recordsDropped = (result.recordsDropped ?? 0) + 1
            continue
          }
          batchRecords.push({
            entityId: params.entityId,
            recordId,
          })
        }

        // Enqueue batch for background processing or index directly
        if (batchRecords.length > 0) {
          if (params.useQueue !== false && this.vectorQueue) {
            await this.vectorQueue.enqueue({
              jobType: 'batch-index',
              tenantId: params.tenantId,
              organizationId: params.organizationId ?? null,
              records: batchRecords,
            })
            jobsEnqueued += 1
            totalProcessed += batchRecords.length
            searchDebug('SearchIndexer', 'Enqueued batch for vector indexing', {
              entityId: params.entityId,
              batchSize: batchRecords.length,
              jobsEnqueued,
              totalProcessed,
            })
          } else {
            // Direct indexing (blocking) - index each record via SearchService
            for (const { entityId, recordId } of batchRecords) {
              try {
                await this.indexRecordById({
                  entityId: entityId as EntityId,
                  recordId,
                  tenantId: params.tenantId,
                  organizationId: params.organizationId,
                })
                totalProcessed++
              } catch (error) {
                searchDebugWarn('SearchIndexer', 'Failed to index record to vector', {
                  entityId,
                  recordId,
                  error: error instanceof Error ? error.message : error,
                })
              }
            }
          }
        }

        if (queryResult.items.length < pageSize) break
        page += 1

        // Safety check to prevent infinite loops
        if (page > MAX_PAGES) {
          searchDebugWarn('SearchIndexer', 'Reached MAX_PAGES limit, stopping pagination', {
            entityId: params.entityId,
            maxPages: MAX_PAGES,
            totalProcessed,
          })
          break
        }
      }

      result.entitiesProcessed = 1
      result.recordsIndexed = totalProcessed
      result.jobsEnqueued = jobsEnqueued

      params.onProgress?.({
        entityId: params.entityId,
        phase: 'complete',
        processed: totalProcessed,
        total: totalProcessed,
      })
    } catch (error) {
      result.success = false
      result.errors.push({
        entityId: params.entityId,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    return result
  }

  /**
   * Reindex all enabled entities to vector search.
   *
   * When `useQueue` is true (default), batches are enqueued for background processing by workers.
   * When `useQueue` is false, batches are indexed directly (blocking).
   */
  async reindexAllToVector(params: ReindexAllParams & { purgeFirst?: boolean }): Promise<ReindexResult> {
    const result: ReindexResult = {
      success: true,
      entitiesProcessed: 0,
      recordsIndexed: 0,
      recordsDropped: 0,
      jobsEnqueued: 0,
      errors: [],
    }

    const entities = this.listEnabledEntities()
    for (const entityId of entities) {
      const entityResult = await this.reindexEntityToVector({
        entityId,
        tenantId: params.tenantId,
        organizationId: params.organizationId,
        onProgress: params.onProgress,
        useQueue: params.useQueue,
        purgeFirst: params.purgeFirst,
      })

      result.entitiesProcessed += entityResult.entitiesProcessed
      result.recordsIndexed += entityResult.recordsIndexed
      result.recordsDropped = (result.recordsDropped ?? 0) + (entityResult.recordsDropped ?? 0)
      result.jobsEnqueued = (result.jobsEnqueued ?? 0) + (entityResult.jobsEnqueued ?? 0)
      result.errors.push(...entityResult.errors)

      if (!entityResult.success) {
        result.success = false
      }
    }

    return result
  }

  /**
   * Build IndexableRecords from raw query results.
   * Returns records and count of dropped items (missing id or other validation failures).
   */
  private async buildIndexableRecords(
    entityId: EntityId,
    tenantId: string,
    organizationId: string | null,
    items: Record<string, unknown>[],
    config: SearchEntityConfig,
  ): Promise<{ records: IndexableRecord[]; dropped: number }> {
    const records: IndexableRecord[] = []
    let dropped = 0

    // Debug: log first item to see structure
    if (items.length > 0) {
      searchDebug('SearchIndexer', 'Sample item structure', {
        entityId,
        sampleKeys: Object.keys(items[0]),
        sampleId: items[0].id,
        hasId: 'id' in items[0],
        firstName: items[0].first_name,
        lastName: items[0].last_name,
        preferredName: items[0].preferred_name,
        sampleItem: JSON.stringify(items[0]).slice(0, 500),
      })
    }

    for (const item of items) {
      const recordId = String(item.id ?? '')
      if (!recordId) {
        searchDebugWarn('SearchIndexer', 'Skipping item without id', { entityId, itemKeys: Object.keys(item) })
        dropped++
        continue
      }

      // Extract custom fields from record
      const customFields: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(item)) {
        if (key.startsWith('cf:') || key.startsWith('cf_')) {
          const cfKey = key.slice(3) // Remove 'cf:' or 'cf_' prefix (both are 3 chars)
          customFields[cfKey] = value
        }
      }

      const buildContext: SearchBuildContext = {
        record: item,
        customFields,
        organizationId,
        tenantId,
        queryEngine: this.noReindexQueryEngine,
      }

      // Try buildSource first (provides text, presenter, links, checksumSource)
      let text: string | string[] | undefined
      let presenter: SearchResultPresenter | undefined
      let url: string | undefined
      let links: SearchResultLink[] | undefined
      let checksumSource: unknown | undefined

      if (config.buildSource) {
        try {
          const source = await config.buildSource(buildContext)
          if (source) {
            text = source.text
            if (source.presenter) presenter = source.presenter
            if (source.links) links = source.links
            if (source.checksumSource !== undefined) checksumSource = source.checksumSource
          }
        } catch (err) {
          searchDebugWarn('SearchIndexer', 'buildSource failed', {
            entityId,
            recordId,
            error: err instanceof Error ? err.message : err,
          })
        }
      }

      // Fall back to formatResult if no presenter from buildSource
      if (!presenter && config.formatResult) {
        try {
          const result = await config.formatResult(buildContext)
          if (result) presenter = result
        } catch {
          // Skip presenter on error
        }
      }

      // Resolve URL if not already set
      if (!url && config.resolveUrl) {
        try {
          const result = await config.resolveUrl(buildContext)
          if (result) url = result
        } catch {
          // Skip URL on error
        }
      }

      // Resolve links if not already set
      if (!links && config.resolveLinks) {
        try {
          const result = await config.resolveLinks(buildContext)
          if (result) links = result
        } catch {
          // Skip links on error
        }
      }

      records.push({
        entityId,
        recordId,
        tenantId,
        organizationId,
        fields: item,
        presenter,
        url,
        links,
        text,
        checksumSource,
      })
    }

    searchDebug('SearchIndexer', 'Finished building records', {
      entityId,
      inputCount: items.length,
      outputCount: records.length,
      dropped,
    })

    return { records, dropped }
  }
}
