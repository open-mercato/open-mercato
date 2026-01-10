import type { QueuedJob, JobContext } from '@open-mercato/queue'
import type { MeilisearchIndexJobPayload } from '../../../queue/meilisearch-indexing'
import type { MeilisearchStrategy } from '../../../strategies/meilisearch.strategy'
import { recordIndexerLog } from '@/lib/indexers/status-log'
import { recordIndexerError } from '@/lib/indexers/error-log'

type HandlerContext = { resolve: <T = unknown>(name: string) => T }

/**
 * Process a Meilisearch indexing job.
 *
 * This handler processes batch indexing, deletion, and purge operations
 * for the Meilisearch search strategy.
 *
 * @param job - The queued job containing payload
 * @param jobCtx - Queue job context with job ID and attempt info
 * @param ctx - DI container context for resolving services
 */
export async function handleMeilisearchIndexJob(
  job: QueuedJob<MeilisearchIndexJobPayload>,
  jobCtx: JobContext,
  ctx: HandlerContext,
): Promise<void> {
  const { jobType, tenantId } = job.payload

  if (!tenantId) {
    console.warn('[meilisearch-index.worker] Skipping job with missing tenantId', {
      jobId: jobCtx.jobId,
      jobType,
    })
    return
  }

  // Resolve EntityManager for logging
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let em: any | null = null
  try {
    em = ctx.resolve('em')
  } catch {
    em = null
  }

  // Resolve Meilisearch strategy
  let meilisearchStrategy: MeilisearchStrategy | undefined
  try {
    const searchStrategies = ctx.resolve<unknown[]>('searchStrategies')
    meilisearchStrategy = searchStrategies?.find(
      (s: unknown) => (s as { id?: string })?.id === 'meilisearch',
    ) as MeilisearchStrategy | undefined
  } catch {
    console.warn('[meilisearch-index.worker] searchStrategies not available')
    return
  }

  if (!meilisearchStrategy) {
    console.warn('[meilisearch-index.worker] Meilisearch strategy not configured')
    return
  }

  // Check if Meilisearch is available
  const isAvailable = await meilisearchStrategy.isAvailable()
  if (!isAvailable) {
    console.warn('[meilisearch-index.worker] Meilisearch is not available')
    throw new Error('Meilisearch is not available') // Will trigger retry
  }

  try {
    if (jobType === 'batch-index') {
      const { records } = job.payload
      if (!records || records.length === 0) {
        console.warn('[meilisearch-index.worker] Skipping batch-index with no records', {
          jobId: jobCtx.jobId,
        })
        return
      }

      await meilisearchStrategy.bulkIndex(records)

      console.log('[meilisearch-index.worker] Batch indexed to Meilisearch', {
        jobId: jobCtx.jobId,
        tenantId,
        recordCount: records.length,
        attemptNumber: jobCtx.attemptNumber,
      })

      await recordIndexerLog(
        { em: em ?? undefined },
        {
          source: 'meilisearch',
          handler: 'worker:meilisearch:batch-index',
          message: `Indexed ${records.length} records to Meilisearch`,
          tenantId,
          details: { jobId: jobCtx.jobId, recordCount: records.length },
        },
      )
    } else if (jobType === 'delete') {
      const { entityId, recordId } = job.payload
      if (!entityId || !recordId) {
        console.warn('[meilisearch-index.worker] Skipping delete with missing fields', {
          jobId: jobCtx.jobId,
          entityId,
          recordId,
        })
        return
      }

      await meilisearchStrategy.delete(entityId, recordId, tenantId)

      console.log('[meilisearch-index.worker] Deleted from Meilisearch', {
        jobId: jobCtx.jobId,
        tenantId,
        entityId,
        recordId,
      })

      await recordIndexerLog(
        { em: em ?? undefined },
        {
          source: 'meilisearch',
          handler: 'worker:meilisearch:delete',
          message: `Deleted record from Meilisearch`,
          entityType: entityId,
          recordId,
          tenantId,
          details: { jobId: jobCtx.jobId },
        },
      )
    } else if (jobType === 'purge') {
      const { entityId } = job.payload
      if (!entityId) {
        console.warn('[meilisearch-index.worker] Skipping purge with missing entityId', {
          jobId: jobCtx.jobId,
        })
        return
      }

      await meilisearchStrategy.purge(entityId, tenantId)

      console.log('[meilisearch-index.worker] Purged entity from Meilisearch', {
        jobId: jobCtx.jobId,
        tenantId,
        entityId,
      })

      await recordIndexerLog(
        { em: em ?? undefined },
        {
          source: 'meilisearch',
          handler: 'worker:meilisearch:purge',
          message: `Purged entity from Meilisearch`,
          entityType: entityId,
          tenantId,
          details: { jobId: jobCtx.jobId },
        },
      )
    }
  } catch (error) {
    console.error(`[meilisearch-index.worker] Failed to ${jobType}`, {
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
        source: 'meilisearch',
        handler: `worker:meilisearch:${jobType}`,
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
