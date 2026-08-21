import type { QueuedJob, JobContext, WorkerMeta } from '@open-mercato/queue'
import type { Kysely } from 'kysely'
import { VECTOR_INDEXING_QUEUE_NAME, type VectorIndexJobPayload } from '../../../queue/vector-indexing'
import type { SearchIndexer } from '../../../indexer/search-indexer'
import type { EmbeddingService, VectorDriver } from '../../../vector'
import type { EntityManager } from '@mikro-orm/postgresql'

import type { ProgressService } from '@open-mercato/core/modules/progress/lib/progressService'
import { recordIndexerError } from '@open-mercato/shared/lib/indexers/error-log'
import { refreshCoverageSnapshot } from '@open-mercato/core/modules/query_index/lib/coverage'
import { logVectorOperation } from '../../../vector/lib/vector-logs'
import { resolveAutoIndexingEnabled } from '../lib/auto-indexing'
import { resolveEmbeddingConfig } from '../lib/embedding-config'
import { searchDebugWarn, searchWarn } from '../../../lib/debug'
import { evaluateVectorPreflight, type VectorPreflightResult } from '../../../vector/lib/preflight'
import { clearReindexLock, updateReindexProgress } from '../lib/reindex-lock'
import { hasActiveReindexProgress, incrementReindexProgress } from '../lib/reindex-progress'

// Worker metadata for auto-discovery
const DEFAULT_CONCURRENCY = 2
const envConcurrency = process.env.WORKERS_VECTOR_INDEXING_CONCURRENCY

export const metadata: WorkerMeta = {
  queue: VECTOR_INDEXING_QUEUE_NAME,
  concurrency: envConcurrency ? parseInt(envConcurrency, 10) : DEFAULT_CONCURRENCY,
}

type HandlerContext = { resolve: <T = unknown>(name: string) => T }
type CoverageEventBus = { emitEvent(event: string, payload: unknown, options?: unknown): Promise<void> }

async function refreshVectorCoverage(params: {
  em: EntityManager | null
  eventBus: CoverageEventBus | null
  entityType: string
  tenantId: string
  organizationId?: string | null
  delayMs?: number
}): Promise<void> {
  if (!params.entityType || !params.tenantId) return

  if (params.eventBus) {
    try {
      await params.eventBus.emitEvent('query_index.coverage.refresh', {
        entityType: params.entityType,
        tenantId: params.tenantId,
        organizationId: params.organizationId ?? null,
        withDeleted: false,
        delayMs: params.delayMs ?? 1000,
      })
      return
    } catch (emitError) {
      searchDebugWarn('vector-index.worker', 'Failed to enqueue vector coverage refresh', {
        entityType: params.entityType,
        error: emitError instanceof Error ? emitError.message : emitError,
      })
    }
  }

  if (params.em) {
    try {
      await refreshCoverageSnapshot(params.em, {
        entityType: params.entityType,
        tenantId: params.tenantId,
        organizationId: params.organizationId ?? null,
        withDeleted: false,
      })
    } catch (coverageError) {
      searchDebugWarn('vector-index.worker', 'Failed to refresh vector coverage', {
        entityType: params.entityType,
        error: coverageError instanceof Error ? coverageError.message : coverageError,
      })
    }
  }
}

/**
 * Decide once per job whether vector work can succeed, so the worker can skip a
 * doomed run with a single warning instead of failing every record. When the
 * embedding service is not resolvable we return `ok` and let the existing
 * strategy path decide, preserving prior behavior.
 *
 * `withProbe` issues one tiny embedding to detect an unreachable provider; use
 * it for bulk reindex batches, not for hot single-record writes.
 */
async function runVectorPreflight(
  ctx: HandlerContext,
  options: { withProbe: boolean },
): Promise<VectorPreflightResult> {
  let embeddingService: EmbeddingService | null = null
  try {
    embeddingService = ctx.resolve<EmbeddingService>('vectorEmbeddingService')
  } catch {
    embeddingService = null
  }
  if (!embeddingService) return { ok: true }

  let tableDimension: number | null = null
  try {
    const drivers = ctx.resolve<VectorDriver[]>('vectorDrivers')
    const pgvectorDriver = drivers.find((driver) => driver.id === 'pgvector')
    if (pgvectorDriver?.getTableDimension) {
      tableDimension = await pgvectorDriver.getTableDimension()
    }
  } catch {
    tableDimension = null
  }

  const service = embeddingService
  return evaluateVectorPreflight({
    providerConfigured: service.available,
    effectiveDimension: typeof service.dimension === 'number' ? service.dimension : null,
    tableDimension,
    probe: options.withProbe ? () => service.createEmbedding('preflight') : undefined,
  })
}

async function advanceVectorReindexProgress(params: {
  db: Kysely<any> | null
  em: EntityManager | null
  progressService: ProgressService | null
  tenantId: string
  organizationId?: string | null
  delta: number
}): Promise<void> {
  if (!Number.isFinite(params.delta) || params.delta <= 0) return

  if (params.progressService && params.em) {
    const hasActiveProgress = await hasActiveReindexProgress({
      em: params.em,
      type: 'vector',
      tenantId: params.tenantId,
      organizationId: params.organizationId ?? null,
    })

    if (!hasActiveProgress) {
      if (params.db) {
        await clearReindexLock(params.db, params.tenantId, 'vector', params.organizationId ?? null)
      }
      return
    }

    if (params.db) {
      await updateReindexProgress(params.db, params.tenantId, 'vector', params.delta, params.organizationId ?? null)
    }

    const completed = await incrementReindexProgress({
      em: params.em,
      progressService: params.progressService,
      type: 'vector',
      tenantId: params.tenantId,
      organizationId: params.organizationId ?? null,
      delta: params.delta,
    })
    if (completed && params.db) {
      await clearReindexLock(params.db, params.tenantId, 'vector', params.organizationId ?? null)
    }
    return
  }

  if (params.db) {
    await updateReindexProgress(params.db, params.tenantId, 'vector', params.delta, params.organizationId ?? null)
  }
}

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

    // Get Kysely for heartbeat updates
    let db: Kysely<any> | null = null
    let em: EntityManager | null = null
    try {
      em = ctx.resolve('em') as EntityManager
      db = (em as unknown as { getKysely: () => Kysely<any> }).getKysely()
    } catch {
      db = null
      em = null
    }

    let progressService: ProgressService | null = null
    try {
      progressService = ctx.resolve<ProgressService>('progressService')
    } catch {
      progressService = null
    }

    let eventBus: CoverageEventBus | null = null
    try {
      eventBus = ctx.resolve<CoverageEventBus>('eventBus')
    } catch {
      eventBus = null
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

    // Preflight once: if the provider is unreachable/misconfigured or its
    // dimension no longer matches the shared vector table, skip the whole batch
    // with a single warning instead of failing every record. Still advance the
    // reindex progress/lock so the run completes (records counted as processed).
    const preflight = await runVectorPreflight(ctx, { withProbe: true })
    if (!preflight.ok) {
      searchWarn('vector-index.worker', `Skipping vector batch: ${preflight.reason}`, {
        jobId: jobCtx.jobId,
        code: preflight.code,
        totalRecords: records.length,
        tenantId,
      })
      await advanceVectorReindexProgress({
        db,
        em,
        progressService,
        tenantId,
        organizationId,
        delta: records.length,
      })
      return
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
    await advanceVectorReindexProgress({
      db,
      em,
      progressService,
      tenantId,
      organizationId,
      delta: records.length,
    })

    const touchedEntities = new Set(records.map((record) => record.entityId).filter(Boolean))
    await Promise.all(
      Array.from(touchedEntities).map((touchedEntity) =>
        refreshVectorCoverage({
          em,
          eventBus,
          entityType: touchedEntity,
          tenantId,
          organizationId,
        }),
      ),
    )

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

  // Preflight index jobs only (delete never needs the provider): skip with a
  // single warning when the provider is misconfigured or the configured
  // dimension no longer matches the shared vector table. No reachability probe
  // here — single-record writes are the hot path and the cheap checks already
  // catch the common misconfiguration without an extra embedding call.
  if (jobType === 'index') {
    const preflight = await runVectorPreflight(ctx, { withProbe: false })
    if (!preflight.ok) {
      searchWarn('vector-index.worker', `Skipping vector index for record: ${preflight.reason}`, {
        jobId: jobCtx.jobId,
        code: preflight.code,
        entityType,
        recordId,
        tenantId,
      })
      return
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let em: any | null = null
  try {
    em = ctx.resolve('em')
  } catch {
    em = null
  }

  let eventBus: CoverageEventBus | null = null
  try {
    eventBus = ctx.resolve<CoverageEventBus>('eventBus')
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
      await refreshVectorCoverage({
        em,
        eventBus,
        entityType,
        tenantId,
        organizationId,
      })
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

/**
 * Default export for worker auto-discovery.
 * Wraps handleVectorIndexJob to match the expected handler signature.
 */
export default async function handle(
  job: QueuedJob<VectorIndexJobPayload>,
  ctx: JobContext & HandlerContext
): Promise<void> {
  return handleVectorIndexJob(job, ctx, ctx)
}
