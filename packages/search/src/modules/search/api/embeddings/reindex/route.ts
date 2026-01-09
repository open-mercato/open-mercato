import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import type { VectorIndexService, EmbeddingService } from '../../../../../vector'
import { recordIndexerLog } from '@/lib/indexers/status-log'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveEmbeddingConfig } from '../../../lib/embedding-config'
import type { Queue } from '@open-mercato/queue'
import type { VectorIndexJobPayload } from '../../../../../queue/vector-indexing'
import { VECTOR_INDEXING_QUEUE_NAME } from '../../../../../queue/vector-indexing'
import { handleVectorIndexJob } from '../../../workers/vector-index.worker'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['search.embeddings.manage'] },
}

/**
 * Check if there are active workers for the vector-indexing queue.
 * Returns the worker count, or 0 if unable to check.
 */
async function getWorkerCount(): Promise<number> {
  if (process.env.QUEUE_STRATEGY !== 'async') {
    return 0
  }

  try {
    const { Queue } = await import('bullmq')
    const redisUrl = process.env.REDIS_URL || process.env.QUEUE_REDIS_URL
    const connection = redisUrl
      ? { url: redisUrl }
      : { host: 'localhost', port: 6379 }
    const queue = new Queue(VECTOR_INDEXING_QUEUE_NAME, { connection })
    const workers = await queue.getWorkers()
    await queue.close()
    return workers.length
  } catch (error) {
    console.warn('[search.embeddings.reindex] Failed to check worker count', error)
    return 0
  }
}

export async function POST(req: Request) {
  const { t } = await resolveTranslations()
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    return NextResponse.json({ error: t('api.errors.unauthorized', 'Unauthorized') }, { status: 401 })
  }

  let payload: any = {}
  try {
    payload = await req.json()
  } catch {}

  const entityId = typeof payload?.entityId === 'string' ? payload.entityId : undefined
  const purgeFirst = payload?.purgeFirst === true

  const container = await createRequestContainer()
  let em: any | null = null
  try {
    em = container.resolve('em')
  } catch {}
  let service: VectorIndexService
  try {
    service = (container.resolve('vectorIndexService') as VectorIndexService)
  } catch {
    return NextResponse.json({ error: t('search.api.errors.indexUnavailable', 'Vector index unavailable') }, { status: 503 })
  }

  // Load saved embedding config and update the embedding service
  try {
    const embeddingConfig = await resolveEmbeddingConfig(container, { defaultValue: null })
    if (embeddingConfig) {
      const embeddingService = container.resolve<EmbeddingService>('vectorEmbeddingService')
      embeddingService.updateConfig(embeddingConfig)
      console.log('[search.embeddings.reindex] using embedding config', {
        providerId: embeddingConfig.providerId,
        model: embeddingConfig.model,
        dimension: embeddingConfig.dimension,
      })
    }
  } catch (err) {
    console.warn('[search.embeddings.reindex] failed to load embedding config, using defaults', err)
  }

  try {
    await recordIndexerLog(
      { em: em ?? undefined },
      {
        source: 'vector',
        handler: 'api:search.embeddings.reindex',
        message: entityId
          ? `Vector reindex requested for ${entityId}`
          : 'Vector reindex requested for all entities',
        entityType: entityId ?? null,
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
        details: { purgeFirst },
      },
    ).catch(() => undefined)
    if (entityId) {
      await service.reindexEntity({ entityId, tenantId: auth.tenantId, organizationId: auth.orgId ?? null, purgeFirst })
    } else {
      await service.reindexAll({ tenantId: auth.tenantId, organizationId: auth.orgId ?? null, purgeFirst })
    }

    // For local queue strategy or async without workers, process jobs immediately
    // For async strategy (Redis) with workers, jobs are processed by separate workers
    const queueStrategy = process.env.QUEUE_STRATEGY || 'local'
    let warning: string | undefined
    let processedSync = false

    // Check if we should process synchronously
    let shouldProcessSync = queueStrategy === 'local'
    if (queueStrategy === 'async') {
      const workerCount = await getWorkerCount()
      if (workerCount === 0) {
        shouldProcessSync = true
        warning = t(
          'search.api.warnings.noWorkersAvailable',
          'No queue workers detected. Processing synchronously instead. Start a worker with: yarn mercato queue worker vector-indexing'
        )
        console.warn('[search.embeddings.reindex] No workers available, falling back to sync mode')
      } else {
        console.log('[search.embeddings.reindex] Found active workers', { workerCount })
      }
    }

    if (shouldProcessSync) {
      let queue: Queue<VectorIndexJobPayload> | null = null
      try {
        queue = container.resolve<Queue<VectorIndexJobPayload>>('vectorIndexQueue')
      } catch {
        queue = null
      }
      if (queue) {
        console.log('[search.embeddings.reindex] Processing queue jobs synchronously...')
        let processed = 0
        let failed = 0
        const result = await queue.process(async (job, ctx) => {
          try {
            await handleVectorIndexJob(job, ctx, { resolve: container.resolve.bind(container) })
            processed++
          } catch (err) {
            failed++
            console.warn('[search.embeddings.reindex] Job failed', {
              jobId: ctx.jobId,
              error: err instanceof Error ? err.message : err,
            })
          }
        })
        processedSync = true
        console.log('[search.embeddings.reindex] Synchronous queue processing complete', {
          processed: result.processed,
          failed: result.failed,
        })
      }
    }

    await recordIndexerLog(
      { em: em ?? undefined },
      {
        source: 'vector',
        handler: 'api:search.embeddings.reindex',
        message: entityId
          ? `Vector reindex accepted for ${entityId}`
          : 'Vector reindex accepted for all entities',
        entityType: entityId ?? null,
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
        details: { purgeFirst, processedSync },
      },
    ).catch(() => undefined)
    return NextResponse.json({ ok: true, warning, processedSync })
  } catch (error: any) {
    const message = typeof error?.message === 'string' ? error.message : t('search.api.errors.reindexFailed', 'Vector reindex failed')
    const status = typeof error?.status === 'number'
      ? error.status
      : (typeof error?.statusCode === 'number' ? error.statusCode : undefined)
    console.error('[search.embeddings.reindex] failed', error)
    await recordIndexerLog(
      { em: em ?? undefined },
      {
        source: 'vector',
        handler: 'api:search.embeddings.reindex',
        level: 'warn',
        message: entityId
          ? `Vector reindex failed for ${entityId}`
          : 'Vector reindex failed for all entities',
        entityType: entityId ?? null,
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
        details: { error: message },
      },
    ).catch(() => undefined)
    return NextResponse.json({ error: message }, { status: status && status >= 400 ? status : 500 })
  }
}
