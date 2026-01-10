import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import type { VectorIndexService, EmbeddingService } from '../../../../../vector'
import { recordIndexerLog } from '@/lib/indexers/status-log'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveEmbeddingConfig } from '../../../lib/embedding-config'
import type { Queue } from '@open-mercato/queue'
import type { VectorIndexJobPayload } from '../../../../../queue/vector-indexing'
import { handleVectorIndexJob } from '../../../workers/vector-index.worker'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['search.embeddings.manage'] },
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
  try {
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

    // TODO: Remove this block when @open-mercato/queue supports auto-processing for local strategy
    // Currently, local queue (file-based) has no background worker, so we process jobs synchronously.
    // Once the queue package implements auto-pulling for local strategy, this workaround can be removed.
    const queueStrategy = process.env.QUEUE_STRATEGY || 'local'
    let processedSync = false

    if (queueStrategy === 'local') {
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
    return NextResponse.json({ ok: true, processedSync })
  } catch (error: unknown) {
    const err = error as { message?: string; status?: number; statusCode?: number }
    // Determine HTTP status from error, if available
    const status = typeof err?.status === 'number'
      ? err.status
      : (typeof err?.statusCode === 'number' ? err.statusCode : 500)
    // Log full error details server-side only
    console.error('[search.embeddings.reindex] failed', {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
      status,
    })
    // Return generic message to client - don't expose internal error details
    return NextResponse.json(
      { error: t('search.api.errors.reindexFailed', 'Vector reindex failed. Please try again or contact support.') },
      { status: status >= 400 ? status : 500 }
    )
  } finally {
    const disposable = container as unknown as { dispose?: () => Promise<void> }
    if (typeof disposable.dispose === 'function') {
      await disposable.dispose()
    }
  }
}
