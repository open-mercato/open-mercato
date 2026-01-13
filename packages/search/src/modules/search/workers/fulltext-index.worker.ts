import type { QueuedJob, JobContext, WorkerMeta } from '@open-mercato/queue'
import { FULLTEXT_INDEXING_QUEUE_NAME, type FulltextIndexJobPayload, type FulltextBatchRecord } from '../../../queue/fulltext-indexing'
import type { FullTextSearchStrategy } from '../../../strategies/fulltext.strategy'
import type { SearchIndexer } from '../../../indexer/search-indexer'
import type {
  IndexableRecord,
  SearchBuildContext,
  SearchResultPresenter,
  SearchResultLink,
  SearchEntityConfig,
} from '../../../types'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { Knex } from 'knex'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import { recordIndexerLog } from '@open-mercato/shared/lib/indexers/status-log'
import { recordIndexerError } from '@open-mercato/shared/lib/indexers/error-log'
import { searchDebug, searchDebugWarn, searchError } from '../../../lib/debug'
import { updateReindexProgress } from '../lib/reindex-lock'
import { extractFallbackPresenter } from '../../../lib/fallback-presenter'

// Worker metadata for auto-discovery
const DEFAULT_CONCURRENCY = 2
const envConcurrency = process.env.WORKERS_FULLTEXT_INDEXING_CONCURRENCY

export const metadata: WorkerMeta = {
  queue: FULLTEXT_INDEXING_QUEUE_NAME,
  concurrency: envConcurrency ? parseInt(envConcurrency, 10) : DEFAULT_CONCURRENCY,
}

type HandlerContext = { resolve: <T = unknown>(name: string) => T }

/** Batch size for loading records from database */
const DB_BATCH_SIZE = 500

/**
 * Load records from entity_indexes table and build IndexableRecords.
 * Groups records by entity type for efficient batch queries.
 */
async function loadRecordsFromDb(
  knex: Knex,
  records: FulltextBatchRecord[],
  tenantId: string,
  organizationId: string | null | undefined,
  searchIndexer: SearchIndexer,
): Promise<IndexableRecord[]> {
  if (records.length === 0) return []

  // Group by entity type for batch query
  const byEntityType = new Map<string, string[]>()
  for (const { entityId, recordId } of records) {
    const ids = byEntityType.get(entityId) ?? []
    ids.push(recordId)
    byEntityType.set(entityId, ids)
  }

  const indexableRecords: IndexableRecord[] = []

  for (const [entityId, recordIds] of byEntityType) {
    // Process in chunks to avoid hitting DB parameter limits
    for (let i = 0; i < recordIds.length; i += DB_BATCH_SIZE) {
      const chunk = recordIds.slice(i, i + DB_BATCH_SIZE)

      // Load docs from entity_indexes
      const query = knex('entity_indexes')
        .select('entity_id', 'doc')
        .where('entity_type', entityId)
        .where('tenant_id', tenantId)
        .whereIn('entity_id', chunk)
        .whereNull('deleted_at')

      // Add organization filter if provided
      if (organizationId) {
        query.where((builder) => {
          builder.where('organization_id', organizationId).orWhereNull('organization_id')
        })
      }

      const rows = await query
      const config = searchIndexer.getEntityConfig(entityId as EntityId)

      for (const row of rows) {
        const doc = row.doc as Record<string, unknown>
        const indexable = await buildIndexableFromDoc(
          doc,
          entityId,
          row.entity_id as string,
          tenantId,
          organizationId,
          config,
        )
        if (indexable) indexableRecords.push(indexable)
      }
    }
  }

  return indexableRecords
}

/**
 * Build an IndexableRecord from a doc loaded from entity_indexes.
 * Uses search.ts config (buildSource, formatResult, etc.) when available,
 * otherwise falls back to extracting common fields.
 */
async function buildIndexableFromDoc(
  doc: Record<string, unknown>,
  entityId: string,
  recordId: string,
  tenantId: string,
  organizationId: string | null | undefined,
  config?: SearchEntityConfig,
): Promise<IndexableRecord | null> {
  // Extract custom fields
  const customFields: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(doc)) {
    if (key.startsWith('cf:') || key.startsWith('cf_')) {
      customFields[key.slice(3)] = value
    }
  }

  const buildContext: SearchBuildContext = {
    record: doc,
    customFields,
    tenantId,
    organizationId,
  }

  let presenter: SearchResultPresenter | undefined
  let url: string | undefined
  let links: SearchResultLink[] | undefined
  let text: string | string[] | undefined

  // Use search.ts config if available
  if (config) {
    if (config.buildSource) {
      try {
        const source = await config.buildSource(buildContext)
        if (source) {
          presenter = source.presenter
          links = source.links
          text = source.text
        }
      } catch (err) {
        searchDebugWarn('fulltext-index.worker', `buildSource failed for ${entityId}:${recordId}`, {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    if (!presenter && config.formatResult) {
      try {
        presenter = (await config.formatResult(buildContext)) ?? undefined
      } catch (err) {
        searchDebugWarn('fulltext-index.worker', `formatResult failed for ${entityId}:${recordId}`, {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    if (config.resolveUrl) {
      try {
        url = (await config.resolveUrl(buildContext)) ?? undefined
      } catch {
        // Skip URL resolution errors
      }
    }

    if (!links && config.resolveLinks) {
      try {
        links = (await config.resolveLinks(buildContext)) ?? undefined
      } catch {
        // Skip link resolution errors
      }
    }
  }

  // Fallback presenter if none from config
  if (!presenter) {
    presenter = extractFallbackPresenter(doc, entityId, recordId)
  }

  return {
    entityId: entityId as EntityId,
    recordId,
    tenantId,
    organizationId: organizationId ?? null,
    fields: doc,
    presenter,
    url,
    links,
    text,
  }
}

/**
 * Process a fulltext indexing job.
 *
 * This handler processes batch indexing, deletion, and purge operations
 * for the fulltext search strategy.
 *
 * @param job - The queued job containing payload
 * @param jobCtx - Queue job context with job ID and attempt info
 * @param ctx - DI container context for resolving services
 */
export async function handleFulltextIndexJob(
  job: QueuedJob<FulltextIndexJobPayload>,
  jobCtx: JobContext,
  ctx: HandlerContext,
): Promise<void> {
  const { jobType, tenantId } = job.payload

  if (!tenantId) {
    searchDebugWarn('fulltext-index.worker', 'Skipping job with missing tenantId', {
      jobId: jobCtx.jobId,
      jobType,
    })
    return
  }

  // Resolve EntityManager for logging and knex for database queries
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let em: any | null = null
  let knex: Knex | null = null
  try {
    em = ctx.resolve('em') as EntityManager
    knex = (em.getConnection() as unknown as { getKnex: () => Knex }).getKnex()
  } catch {
    em = null
    knex = null
  }

  // Resolve searchIndexer for entity configs
  let searchIndexer: SearchIndexer | undefined
  try {
    searchIndexer = ctx.resolve<SearchIndexer>('searchIndexer')
  } catch {
    searchDebugWarn('fulltext-index.worker', 'searchIndexer not available')
  }

  // Resolve fulltext strategy
  let fulltextStrategy: FullTextSearchStrategy | undefined
  try {
    const searchStrategies = ctx.resolve<unknown[]>('searchStrategies')
    fulltextStrategy = searchStrategies?.find(
      (s: unknown) => (s as { id?: string })?.id === 'fulltext',
    ) as FullTextSearchStrategy | undefined
  } catch {
    searchDebugWarn('fulltext-index.worker', 'searchStrategies not available')
    return
  }

  if (!fulltextStrategy) {
    searchDebugWarn('fulltext-index.worker', 'Fulltext strategy not configured')
    return
  }

  // Check if fulltext is available
  const isAvailable = await fulltextStrategy.isAvailable()
  if (!isAvailable) {
    searchDebugWarn('fulltext-index.worker', 'Fulltext search is not available')
    throw new Error('Fulltext search is not available') // Will trigger retry
  }

  try {
    if (jobType === 'batch-index') {
      const { records, organizationId } = job.payload
      if (!records || records.length === 0) {
        searchDebugWarn('fulltext-index.worker', 'Skipping batch-index with no records', {
          jobId: jobCtx.jobId,
        })
        return
      }

      // Load fresh data from database and build IndexableRecords
      if (!knex || !searchIndexer) {
        searchError('fulltext-index.worker', 'Cannot load records: knex or searchIndexer not available', {
          jobId: jobCtx.jobId,
          hasKnex: !!knex,
          hasSearchIndexer: !!searchIndexer,
        })
        throw new Error('Database connection or searchIndexer not available')
      }

      const indexableRecords = await loadRecordsFromDb(
        knex,
        records,
        tenantId,
        organizationId,
        searchIndexer,
      )

      if (indexableRecords.length === 0) {
        searchDebugWarn('fulltext-index.worker', 'No records found in database for batch', {
          jobId: jobCtx.jobId,
          requestedCount: records.length,
        })
        return
      }

      await fulltextStrategy.bulkIndex(indexableRecords)

      // Update heartbeat to signal worker is still processing
      if (knex) {
        await updateReindexProgress(knex, tenantId, 'fulltext', indexableRecords.length, organizationId as string | null)
      }

      searchDebug('fulltext-index.worker', 'Batch indexed to fulltext', {
        jobId: jobCtx.jobId,
        tenantId,
        requestedCount: records.length,
        indexedCount: indexableRecords.length,
        attemptNumber: jobCtx.attemptNumber,
      })

      await recordIndexerLog(
        { em: em ?? undefined },
        {
          source: 'fulltext',
          handler: 'worker:fulltext:batch-index',
          message: `Indexed ${indexableRecords.length} records to fulltext`,
          tenantId,
          details: { jobId: jobCtx.jobId, requestedCount: records.length, indexedCount: indexableRecords.length },
        },
      )
    } else if (jobType === 'delete') {
      const { entityId, recordId } = job.payload
      if (!entityId || !recordId) {
        searchDebugWarn('fulltext-index.worker', 'Skipping delete with missing fields', {
          jobId: jobCtx.jobId,
          entityId,
          recordId,
        })
        return
      }

      await fulltextStrategy.delete(entityId, recordId, tenantId)

      searchDebug('fulltext-index.worker', 'Deleted from fulltext', {
        jobId: jobCtx.jobId,
        tenantId,
        entityId,
        recordId,
      })

      await recordIndexerLog(
        { em: em ?? undefined },
        {
          source: 'fulltext',
          handler: 'worker:fulltext:delete',
          message: `Deleted record from fulltext`,
          entityType: entityId,
          recordId,
          tenantId,
          details: { jobId: jobCtx.jobId },
        },
      )
    } else if (jobType === 'purge') {
      const { entityId } = job.payload
      if (!entityId) {
        searchDebugWarn('fulltext-index.worker', 'Skipping purge with missing entityId', {
          jobId: jobCtx.jobId,
        })
        return
      }

      await fulltextStrategy.purge(entityId, tenantId)

      searchDebug('fulltext-index.worker', 'Purged entity from fulltext', {
        jobId: jobCtx.jobId,
        tenantId,
        entityId,
      })

      await recordIndexerLog(
        { em: em ?? undefined },
        {
          source: 'fulltext',
          handler: 'worker:fulltext:purge',
          message: `Purged entity from fulltext`,
          entityType: entityId,
          tenantId,
          details: { jobId: jobCtx.jobId },
        },
      )
    }
  } catch (error) {
    searchError('fulltext-index.worker', `Failed to ${jobType}`, {
      jobId: jobCtx.jobId,
      tenantId,
      error: error instanceof Error ? error.message : error,
      attemptNumber: jobCtx.attemptNumber,
    })

    const entityId = 'entityId' in job.payload ? job.payload.entityId : undefined
    const recordId = 'recordId' in job.payload ? job.payload.recordId : undefined

    await recordIndexerError(
      { em: em ?? undefined },
      {
        source: 'fulltext',
        handler: `worker:fulltext:${jobType}`,
        error,
        entityType: entityId,
        recordId,
        tenantId,
        payload: job.payload,
      },
    )

    // Re-throw to let the queue handle retry logic
    throw error
  }
}

/**
 * Default export for worker auto-discovery.
 * Wraps handleFulltextIndexJob to match the expected handler signature.
 */
export default async function handle(
  job: QueuedJob<FulltextIndexJobPayload>,
  ctx: JobContext & HandlerContext
): Promise<void> {
  return handleFulltextIndexJob(job, ctx, ctx)
}
