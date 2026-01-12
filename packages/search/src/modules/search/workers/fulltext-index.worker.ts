import type { QueuedJob, JobContext } from '@open-mercato/queue'
import type { FulltextIndexJobPayload } from '../../../queue/fulltext-indexing'
import type { FullTextSearchStrategy } from '../../../strategies/fulltext.strategy'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { Knex } from 'knex'
import { recordIndexerLog } from '@/lib/indexers/status-log'
import { recordIndexerError } from '@/lib/indexers/error-log'
import { searchDebug, searchDebugWarn, searchError } from '../../../lib/debug'
import { updateReindexProgress } from '../lib/reindex-lock'

type HandlerContext = { resolve: <T = unknown>(name: string) => T }

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

  // Resolve EntityManager for logging and knex for heartbeat updates
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
      const { records } = job.payload
      if (!records || records.length === 0) {
        searchDebugWarn('fulltext-index.worker', 'Skipping batch-index with no records', {
          jobId: jobCtx.jobId,
        })
        return
      }

      await fulltextStrategy.bulkIndex(records)

      // Update heartbeat to signal worker is still processing
      if (knex) {
        const orgId = 'organizationId' in job.payload ? job.payload.organizationId : null
        await updateReindexProgress(knex, tenantId, 'fulltext', records.length, orgId as string | null)
      }

      searchDebug('fulltext-index.worker', 'Batch indexed to fulltext', {
        jobId: jobCtx.jobId,
        tenantId,
        recordCount: records.length,
        attemptNumber: jobCtx.attemptNumber,
      })

      await recordIndexerLog(
        { em: em ?? undefined },
        {
          source: 'fulltext',
          handler: 'worker:fulltext:batch-index',
          message: `Indexed ${records.length} records to fulltext`,
          tenantId,
          details: { jobId: jobCtx.jobId, recordCount: records.length },
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
