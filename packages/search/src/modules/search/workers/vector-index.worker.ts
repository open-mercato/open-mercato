import type { QueuedJob, JobContext } from '@open-mercato/queue'
import type { VectorIndexJobPayload } from '../../../queue/vector-indexing'
import type { VectorIndexService, VectorIndexOperationResult, EmbeddingService } from '../../../vector'
import { recordIndexerError } from '@/lib/indexers/error-log'
import { applyCoverageAdjustments, createCoverageAdjustments } from '@open-mercato/core/modules/query_index/lib/coverage'
import { logVectorOperation } from '../../../vector/lib/vector-logs'
import { resolveAutoIndexingEnabled } from '../lib/auto-indexing'
import { resolveEmbeddingConfig } from '../lib/embedding-config'

type HandlerContext = { resolve: <T = unknown>(name: string) => T }

/**
 * Process a vector index job.
 *
 * This handler is called by the queue worker to process indexing and deletion jobs.
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
  const { jobType, entityType, recordId, tenantId, organizationId } = job.payload

  if (!entityType || !recordId || !tenantId) {
    console.warn('[vector-index.worker] Skipping job with missing required fields', {
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

  let service: VectorIndexService
  try {
    service = ctx.resolve<VectorIndexService>('vectorIndexService')
  } catch {
    console.warn('[vector-index.worker] vectorIndexService not available')
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
      console.warn('[vector-index.worker] Failed to load embedding config, using defaults', configErr)
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
    let result: VectorIndexOperationResult

    if (jobType === 'delete') {
      result = await service.deleteRecord({
        entityId: entityType,
        recordId,
        tenantId,
        organizationId,
      })
    } else {
      result = await service.indexRecord({
        entityId: entityType,
        recordId,
        tenantId,
        organizationId,
      })
    }

    const delta = computeVectorDelta(result)

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
          console.warn('[vector-index.worker] Failed to adjust vector coverage', coverageError)
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
          console.warn('[vector-index.worker] Failed to enqueue coverage refresh', emitError)
        }
      }
    }

    await logVectorOperation({
      em,
      handler: handlerName,
      entityType,
      recordId,
      result,
    })
  } catch (error) {
    console.warn(`[vector-index.worker] Failed to ${jobType} vector index`, {
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

function computeVectorDelta(result: VectorIndexOperationResult): number {
  if (!result) return 0
  if (result.action === 'indexed') {
    return result.created ? 1 : 0
  }
  if (result.action === 'deleted') {
    return result.existed ? -1 : 0
  }
  return 0
}
