import type { QueuedJob, JobContext, WorkerMeta } from '@open-mercato/queue'
import { FULLTEXT_INDEXING_QUEUE_NAME, type FulltextIndexJobPayload } from '../../../queue/fulltext-indexing'
import type { FullTextSearchStrategy } from '../../../strategies/fulltext.strategy'
import type { SearchIndexer } from '../../../indexer/search-indexer'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { Knex } from 'knex'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import { recordIndexerLog } from '@open-mercato/shared/lib/indexers/status-log'
import { recordIndexerError } from '@open-mercato/shared/lib/indexers/error-log'
import { searchDebug, searchDebugWarn, searchError } from '../../../lib/debug'
import { updateReindexProgress } from '../lib/reindex-lock'

// Worker metadata for auto-discovery
const DEFAULT_CONCURRENCY = 2
const envConcurrency = process.env.WORKERS_FULLTEXT_INDEXING_CONCURRENCY

export const metadata: WorkerMeta = {
  queue: FULLTEXT_INDEXING_QUEUE_NAME,
  concurrency: envConcurrency ? parseInt(envConcurrency, 10) : DEFAULT_CONCURRENCY,
}

type HandlerContext = { resolve: <T = unknown>(name: string) => T }

/**
 * Process a fulltext indexing job.
 *
 * This handler processes single record indexing, batch indexing, deletion, and purge
 * operations for the fulltext search strategy.
 *
 * All indexing operations (single and batch) use searchIndexer.indexRecordById() to load
 * fresh data, ensuring consistency with the vector worker pattern.
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

  // Resolve searchIndexer for loading fresh data
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
    throw new Error('Fulltext search is not available') // Will trigger retry
  }

  try {
    // ========== SINGLE INDEX: Use searchIndexer.indexRecordById() for fresh data ==========
    if (jobType === 'index') {
      const { entityType, recordId, organizationId } = job.payload as {
        entityType: string
        recordId: string
        organizationId?: string | null
      }

      if (!entityType || !recordId) {
        searchDebugWarn('fulltext-index.worker', 'Skipping index with missing fields', {
          jobId: jobCtx.jobId,
          entityType,
          recordId,
        })
        return
      }

      if (!searchIndexer) {
        throw new Error('searchIndexer not available for single-record index')
      }

      const result = await searchIndexer.indexRecordById({
        entityId: entityType as EntityId,
        recordId,
        tenantId,
        organizationId,
      })

      searchDebug('fulltext-index.worker', 'Indexed single record to fulltext', {
        jobId: jobCtx.jobId,
        tenantId,
        entityType,
        recordId,
        action: result.action,
      })

      await recordIndexerLog(
        { em: em ?? undefined },
        {
          source: 'fulltext',
          handler: 'worker:fulltext:index',
          message: `Indexed record to fulltext (${result.action})`,
          entityType,
          recordId,
          tenantId,
          details: { jobId: jobCtx.jobId },
        },
      )
      return
    }

    // ========== BATCH-INDEX: Use searchIndexer.indexRecordById() for fresh data ==========
    if (jobType === 'batch-index') {
      const { records, organizationId } = job.payload
      if (!records || records.length === 0) {
        searchDebugWarn('fulltext-index.worker', 'Skipping batch-index with no records', {
          jobId: jobCtx.jobId,
        })
        return
      }

      if (!searchIndexer) {
        throw new Error('searchIndexer not available for batch indexing')
      }

      // Process each record using indexRecordById (same pattern as vector worker)
      let successCount = 0
      let failCount = 0

      for (const { entityId, recordId } of records) {
        try {
          const result = await searchIndexer.indexRecordById({
            entityId: entityId as EntityId,
            recordId,
            tenantId,
            organizationId,
          })
          if (result.action === 'indexed') {
            successCount++
          }
        } catch (error) {
          failCount++
          searchDebugWarn('fulltext-index.worker', 'Failed to index record in batch', {
            entityId,
            recordId,
            error: error instanceof Error ? error.message : error,
          })
        }
      }

      // Update heartbeat to signal worker is still processing
      if (knex && successCount > 0) {
        await updateReindexProgress(knex, tenantId, 'fulltext', successCount, organizationId ?? null)
      }

      searchDebug('fulltext-index.worker', 'Batch indexed to fulltext', {
        jobId: jobCtx.jobId,
        tenantId,
        requestedCount: records.length,
        successCount,
        failCount,
      })

      await recordIndexerLog(
        { em: em ?? undefined },
        {
          source: 'fulltext',
          handler: 'worker:fulltext:batch-index',
          message: `Indexed ${successCount}/${records.length} records to fulltext`,
          tenantId,
          details: { jobId: jobCtx.jobId, requestedCount: records.length, successCount, failCount },
        },
      )
      return
    }

    // ========== DELETE ==========
    if (jobType === 'delete') {
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
      return
    }

    // ========== PURGE ==========
    if (jobType === 'purge') {
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
      return
    }
  } catch (error) {
    searchError('fulltext-index.worker', `Failed to ${jobType}`, {
      jobId: jobCtx.jobId,
      tenantId,
      error: error instanceof Error ? error.message : error,
      attemptNumber: jobCtx.attemptNumber,
    })

    const entityId = 'entityId' in job.payload ? job.payload.entityId :
                     'entityType' in job.payload ? (job.payload as { entityType?: string }).entityType : undefined
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
