import type { QueuedJob, JobContext } from '@open-mercato/queue'
import type { VectorIndexJobPayload } from '../../../queue/vector-indexing'
import type { SearchIndexer } from '../../../indexer/search-indexer'
import type { EmbeddingService } from '../../../vector'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { Knex } from 'knex'
import { recordIndexerError } from '@/lib/indexers/error-log'
import { applyCoverageAdjustments, createCoverageAdjustments } from '@open-mercato/core/modules/query_index/lib/coverage'
import { logVectorOperation } from '../../../vector/lib/vector-logs'
import { resolveAutoIndexingEnabled } from '../lib/auto-indexing'
import { resolveEmbeddingConfig } from '../lib/embedding-config'
import { searchDebugWarn } from '../../../lib/debug'
import { updateReindexProgress } from '../lib/reindex-lock'

type HandlerContext = { resolve: <T = unknown>(name: string) => T }

/**
 * Process a vector index job.
 *
 * This handler is called by the queue worker to process indexing and deletion jobs.
 * It uses SearchIndexer to load records and index them via SearchService.
 *
 * @param job - The queued job containing payload
 * @param jobCtx - Queue job context with job ID and attempt info
 * @param ctx - DI container context for resolving services
 */
export async function handleVectorIndexJob(
  job: QueuedJob<VectorIndexJobPayload>,
  jobCtx: JobContext,
  ctx: HandlerContext,
): Promise<void> {
  const { jobType, entityType, recordId, tenantId, organizationId, records } = job.payload

  // Handle batch-index jobs (from reindex operations)
  if (jobType === 'batch-index') {
    if (!records?.length || !tenantId) {
      searchDebugWarn('vector-index.worker', 'Skipping batch-index job with missing required fields', {
        jobId: jobCtx.jobId,
        recordCount: records?.length ?? 0,
        tenantId,
      })
      return
    }

    let searchIndexer: SearchIndexer
    try {
      searchIndexer = ctx.resolve<SearchIndexer>('searchIndexer')
    } catch {
      searchDebugWarn('vector-index.worker', 'searchIndexer not available')
      return
    }

    // Get knex for heartbeat updates
    let knex: Knex | null = null
    try {
      const em = ctx.resolve('em') as EntityManager
      knex = (em.getConnection() as unknown as { getKnex: () => Knex }).getKnex()
    } catch {
      knex = null
    }

    // Load saved embedding config to use the correct provider/model
    try {
      const embeddingConfig = await resolveEmbeddingConfig(ctx, { defaultValue: null })
      if (embeddingConfig) {
        const embeddingService = ctx.resolve<EmbeddingService>('vectorEmbeddingService')
        embeddingService.updateConfig(embeddingConfig)
      }
    } catch (configErr) {
      searchDebugWarn('vector-index.worker', 'Failed to load embedding config for batch, using defaults', {
        error: configErr instanceof Error ? configErr.message : configErr,
      })
    }

    // Process each record in the batch
    let successCount = 0
    let failCount = 0
    for (const { entityId, recordId: recId } of records) {
      try {
        const result = await searchIndexer.indexRecordById({
          entityId: entityId as Parameters<typeof searchIndexer.indexRecordById>[0]['entityId'],
          recordId: recId,
          tenantId,
          organizationId,
        })
        if (result.action === 'indexed') {
          successCount++
        }
      } catch (error) {
        failCount++
        searchDebugWarn('vector-index.worker', 'Failed to index record in batch', {
          entityId,
          recordId: recId,
          error: error instanceof Error ? error.message : error,
        })
      }
    }

    // Update heartbeat to signal worker is still processing
    if (knex && successCount > 0) {
      await updateReindexProgress(knex, tenantId, 'vector', successCount, organizationId ?? null)
    }

    searchDebugWarn('vector-index.worker', 'Batch-index job completed', {
      jobId: jobCtx.jobId,
      totalRecords: records.length,
      successCount,
      failCount,
    })
    return
  }

  // Handle single record jobs (index/delete)
  if (!entityType || !recordId || !tenantId) {
    searchDebugWarn('vector-index.worker', 'Skipping job with missing required fields', {
      jobId: jobCtx.jobId,
      entityType,
      recordId,
      tenantId,
    })
    return
  }

  const autoIndexingEnabled = await resolveAutoIndexingEnabled(ctx, { defaultValue: true })
  if (!autoIndexingEnabled) {
    return
  }

  let searchIndexer: SearchIndexer
  try {
    searchIndexer = ctx.resolve<SearchIndexer>('searchIndexer')
  } catch {
    searchDebugWarn('vector-index.worker', 'searchIndexer not available')
    return
  }

  // Load saved embedding config to use the correct provider/model
  try {
    const embeddingConfig = await resolveEmbeddingConfig(ctx, { defaultValue: null })
    if (embeddingConfig) {
      const embeddingService = ctx.resolve<EmbeddingService>('vectorEmbeddingService')
      embeddingService.updateConfig(embeddingConfig)
    }
  } catch (configErr) {
    // Delete operations don't require embedding, only warn for index operations
    if (jobType === 'index') {
      searchDebugWarn('vector-index.worker', 'Failed to load embedding config, using defaults', {
        error: configErr instanceof Error ? configErr.message : configErr,
      })
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let em: any | null = null
  try {
    em = ctx.resolve('em')
  } catch {
    em = null
  }

  let eventBus: { emitEvent(event: string, payload: unknown, options?: unknown): Promise<void> } | null = null
  try {
    eventBus = ctx.resolve('eventBus')
  } catch {
    eventBus = null
  }

  const handlerName = jobType === 'delete'
    ? 'worker:vector-indexing:delete'
    : 'worker:vector-indexing:index'

  try {
    let action: 'indexed' | 'deleted' | 'skipped' = 'skipped'
    let delta = 0

    if (jobType === 'delete') {
      await searchIndexer.deleteRecord({
        entityId: entityType,
        recordId,
        tenantId,
      })
      action = 'deleted'
      delta = -1
    } else {
      const result = await searchIndexer.indexRecordById({
        entityId: entityType,
        recordId,
        tenantId,
        organizationId,
      })
      action = result.action
      if (result.action === 'indexed') {
        delta = 1
      }
    }

    if (delta !== 0) {
      let adjustmentsApplied = false
      if (em) {
        try {
          const adjustments = createCoverageAdjustments({
            entityType,
            tenantId,
            organizationId,
            baseDelta: 0,
            indexDelta: 0,
            vectorDelta: delta,
          })
          if (adjustments.length) {
            await applyCoverageAdjustments(em, adjustments)
            adjustmentsApplied = true
          }
        } catch (coverageError) {
          searchDebugWarn('vector-index.worker', 'Failed to adjust vector coverage', {
            error: coverageError instanceof Error ? coverageError.message : coverageError,
          })
        }
      }

      if (!adjustmentsApplied && eventBus) {
        try {
          await eventBus.emitEvent('query_index.coverage.refresh', {
            entityType,
            tenantId,
            organizationId,
            withDeleted: false,
            delayMs: 1000,
          })
        } catch (emitError) {
          searchDebugWarn('vector-index.worker', 'Failed to enqueue coverage refresh', {
            error: emitError instanceof Error ? emitError.message : emitError,
          })
        }
      }
    }

    await logVectorOperation({
      em,
      handler: handlerName,
      entityType,
      recordId,
      result: {
        action,
        tenantId,
        organizationId: organizationId ?? null,
        created: action === 'indexed',
        existed: action === 'deleted',
      },
    })
  } catch (error) {
    searchDebugWarn('vector-index.worker', `Failed to ${jobType} vector index`, {
      entityType,
      recordId,
      error: error instanceof Error ? error.message : error,
    })
    await recordIndexerError(
      { em: em ?? undefined },
      {
        source: 'vector',
        handler: handlerName,
        error,
        entityType,
        recordId,
        tenantId,
        organizationId,
        payload: job.payload,
      },
    )
    // Re-throw to let the queue handle retry logic
    throw error
  }
}
