import type { QueuedJob, JobContext, WorkerMeta } from '@open-mercato/queue'
import type { Kysely } from 'kysely'
import {
  FULLTEXT_INDEXING_QUEUE_NAME,
  type FulltextIndexJobPayload,
  type FulltextIndexJobType,
} from '../../../queue/fulltext-indexing'
import type { FullTextSearchStrategy } from '../../../strategies/fulltext.strategy'
import type { SearchIndexer } from '../../../indexer/search-indexer'
import type { EntityManager } from '@mikro-orm/postgresql'

import type { EntityId } from '@open-mercato/shared/modules/entities'
import { recordIndexerLog } from '@open-mercato/shared/lib/indexers/status-log'
import { recordIndexerError } from '@open-mercato/shared/lib/indexers/error-log'
import type { ProgressService } from '@open-mercato/core/modules/progress/lib/progressService'
import { searchDebug, searchDebugWarn, searchError, searchWarn } from '../../../lib/debug'
import { clearReindexLock, updateReindexProgress } from '../lib/reindex-lock'
import { hasActiveReindexProgress, incrementReindexProgress } from '../lib/reindex-progress'

// Worker metadata for auto-discovery
const DEFAULT_CONCURRENCY = 2
const envConcurrency = process.env.WORKERS_FULLTEXT_INDEXING_CONCURRENCY

export const metadata: WorkerMeta = {
  queue: FULLTEXT_INDEXING_QUEUE_NAME,
  concurrency: envConcurrency ? parseInt(envConcurrency, 10) : DEFAULT_CONCURRENCY,
}

type HandlerContext = { resolve: <T = unknown>(name: string) => T }

async function advanceFulltextReindexProgress(params: {
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
      type: 'fulltext',
      tenantId: params.tenantId,
      organizationId: params.organizationId ?? null,
    })

    if (!hasActiveProgress) {
      if (params.db) {
        await clearReindexLock(params.db, params.tenantId, 'fulltext', params.organizationId ?? null)
      }
      return
    }

    if (params.db) {
      await updateReindexProgress(params.db, params.tenantId, 'fulltext', params.delta, params.organizationId ?? null)
    }

    const completed = await incrementReindexProgress({
      em: params.em,
      progressService: params.progressService,
      type: 'fulltext',
      tenantId: params.tenantId,
      organizationId: params.organizationId ?? null,
      delta: params.delta,
    })
    if (completed && params.db) {
      await clearReindexLock(params.db, params.tenantId, 'fulltext', params.organizationId ?? null)
    }
    return
  }

  if (params.db) {
    await updateReindexProgress(params.db, params.tenantId, 'fulltext', params.delta, params.organizationId ?? null)
  }
}

/**
 * Report a job that returned without indexing anything.
 *
 * A fulltext strategy that was never registered (no `MEILISEARCH_HOST`, so
 * `createFulltextDriver()` returns null and `di.ts` pushes no strategy) makes
 * every job a no-op. The bare `return` that follows leaves BullMQ reporting
 * `completed` with zero failures and writes no `indexer_status_logs` row, so
 * "fulltext is not configured" and "everything indexed fine" are
 * indistinguishable from both signals an operator has. Absence of a row is the
 * only trace, and absence is what a healthy never-ran system looks like too.
 *
 * So: write a `warn` row into the same table that answers "did indexing run?",
 * and log through `searchError` rather than `searchDebugWarn` — a
 * misconfiguration that voids every indexing job should not need
 * `OM_SEARCH_DEBUG=1` to be readable.
 *
 * Deliberately does NOT throw. A deployment may legitimately run without
 * Meilisearch, and throwing would retry these jobs forever, turning a
 * configuration choice into a queue backlog. The `isAvailable()` check further
 * down throws precisely because a registered-but-unreachable Meili is expected
 * to recover; an unregistered strategy is not.
 */
async function reportSkippedWithoutIndexing(params: {
  em: EntityManager | null
  jobType: FulltextIndexJobType
  tenantId: string
  organizationId: string | null
  jobId: string
  reason: string
}): Promise<void> {
  const message = `${params.reason}; job skipped without indexing`
  searchError('fulltext-index.worker', message, {
    jobId: params.jobId,
    tenantId: params.tenantId,
    jobType: params.jobType,
  })
  await recordIndexerLog(
    { em: params.em ?? undefined },
    {
      source: 'fulltext',
      handler: `worker:fulltext:${params.jobType}`,
      level: 'warn',
      message,
      tenantId: params.tenantId,
      organizationId: params.organizationId,
      details: { jobId: params.jobId, jobType: params.jobType, skippedWithoutIndexing: true },
    },
  )
}

/**
 * Process a fulltext indexing job.
 *
 * This handler processes single record indexing, batch indexing, deletion, and purge
 * operations for the fulltext search strategy.
 *
 * Single-record jobs load fresh data via searchIndexer.indexRecordById(). Batch jobs load
 * fresh data per record via searchIndexer.indexRecordsById(), which flushes the whole batch
 * through a single bulk write instead of one write per record.
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
  const payloadOrganizationId =
    'organizationId' in job.payload ? job.payload.organizationId ?? null : null

  if (!tenantId) {
    searchDebugWarn('fulltext-index.worker', 'Skipping job with missing tenantId', {
      jobId: jobCtx.jobId,
      jobType,
    })
    return
  }

  // Resolve EntityManager for logging and Kysely for database queries
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let em: any | null = null
  let db: Kysely<any> | null = null
  try {
    em = ctx.resolve('em') as EntityManager
    db = (em as unknown as { getKysely: () => Kysely<any> }).getKysely()
  } catch {
    em = null
    db = null
  }

  // Resolve searchIndexer for loading fresh data
  let searchIndexer: SearchIndexer | undefined
  try {
    searchIndexer = ctx.resolve<SearchIndexer>('searchIndexer')
  } catch {
    // Not a skip on its own: delete/purge never touch the indexer, and the
    // index/batch-index branches throw explicitly when they need it. Still
    // worth reading without OM_SEARCH_DEBUG, because it precedes those throws.
    searchWarn('fulltext-index.worker', 'searchIndexer not available')
  }

  // Resolve fulltext strategy
  let fulltextStrategy: FullTextSearchStrategy | undefined
  try {
    const searchStrategies = ctx.resolve<unknown[]>('searchStrategies')
    fulltextStrategy = searchStrategies?.find(
      (s: unknown) => (s as { id?: string })?.id === 'fulltext',
    ) as FullTextSearchStrategy | undefined
  } catch {
    await reportSkippedWithoutIndexing({
      em,
      jobType,
      tenantId,
      organizationId: payloadOrganizationId,
      jobId: jobCtx.jobId,
      reason: 'searchStrategies not available',
    })
    return
  }

  if (!fulltextStrategy) {
    await reportSkippedWithoutIndexing({
      em,
      jobType,
      tenantId,
      organizationId: payloadOrganizationId,
      jobId: jobCtx.jobId,
      reason: 'Fulltext strategy not configured (MEILISEARCH_HOST unset?)',
    })
    return
  }

  // Check if fulltext is available
  const isAvailable = await fulltextStrategy.isAvailable()
  if (!isAvailable) {
    throw new Error('Fulltext search is not available') // Will trigger retry
  }

  try {
    let progressService: ProgressService | null = null
    try {
      progressService = ctx.resolve<ProgressService>('progressService')
    } catch {
      progressService = null
    }

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

    // ========== BATCH-INDEX: Load fresh data, write the whole batch in one call ==========
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

      // Load and index the whole batch through a single bulk write instead of
      // one indexRecordById() call per record.
      const { indexed: successCount, skipped: skippedCount } = await searchIndexer.indexRecordsById({
        items: records.map(({ entityId, recordId }) => ({ entityId: entityId as EntityId, recordId })),
        tenantId,
        organizationId,
      })

      await advanceFulltextReindexProgress({
        db,
        em,
        progressService,
        tenantId,
        organizationId: organizationId ?? null,
        delta: records.length,
      })

      searchDebug('fulltext-index.worker', 'Batch indexed to fulltext', {
        jobId: jobCtx.jobId,
        tenantId,
        requestedCount: records.length,
        successCount,
        skippedCount,
      })

      await recordIndexerLog(
        { em: em ?? undefined },
        {
          source: 'fulltext',
          handler: 'worker:fulltext:batch-index',
          message: `Indexed ${successCount}/${records.length} records to fulltext`,
          tenantId,
          details: { jobId: jobCtx.jobId, requestedCount: records.length, successCount, skippedCount },
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
