import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import type { SearchIndexer } from '../../../../../indexer/search-indexer'
import type { EmbeddingService } from '../../../../../vector'
import type { Queue } from '@open-mercato/queue'
import { recordIndexerLog } from '@open-mercato/shared/lib/indexers/status-log'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveEmbeddingConfig } from '../../../lib/embedding-config'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import { searchDebug, searchDebugWarn, searchError } from '../../../../../lib/debug'
import { acquireReindexLock, getReindexLockStatus } from '../../../lib/reindex-lock'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['search.embeddings.manage'] },
}

export async function POST(req: Request) {
  const { t } = await resolveTranslations()
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    return NextResponse.json({ error: t('api.errors.unauthorized', 'Unauthorized') }, { status: 401 })
  }

  let payload: { entityId?: string; purgeFirst?: boolean } = {}
  try {
    payload = await req.json()
  } catch {
    // Default values
  }

  const entityId = typeof payload?.entityId === 'string' ? payload.entityId : undefined
  const purgeFirst = payload?.purgeFirst === true

  const container = await createRequestContainer()

  // Try to resolve the vector queue for smarter lock detection
  let vectorQueue: Queue | undefined
  try {
    vectorQueue = container.resolve<Queue>('vectorIndexQueue')
  } catch { /* Queue not available */ }

  // Check if another vector reindex operation is already in progress
  const existingLock = await getReindexLockStatus(container, auth.tenantId, { queue: vectorQueue, type: 'vector' })
  if (existingLock) {
    const startedAt = new Date(existingLock.startedAt)
    return NextResponse.json(
      {
        error: t('search.api.errors.reindexInProgress', 'A reindex operation is already in progress'),
        lock: {
          type: existingLock.type,
          action: existingLock.action,
          startedAt: existingLock.startedAt,
          elapsedMinutes: Math.round((Date.now() - startedAt.getTime()) / 60000),
        },
      },
      { status: 409 }
    )
  }

  // Acquire lock before starting the operation
  const lockAcquired = await acquireReindexLock(container, {
    type: 'vector',
    action: entityId ? `reindex:${entityId}` : 'reindex:all',
    tenantId: auth.tenantId,
    organizationId: auth.orgId ?? null,
  })

  if (!lockAcquired) {
    return NextResponse.json(
      { error: t('search.api.errors.lockFailed', 'Failed to acquire reindex lock') },
      { status: 409 }
    )
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let em: any = null
    try {
      em = container.resolve('em')
    } catch {
      // em not available
    }

    let searchIndexer: SearchIndexer
    try {
      searchIndexer = container.resolve('searchIndexer') as SearchIndexer
    } catch {
      return NextResponse.json(
        { error: t('search.api.errors.indexUnavailable', 'Search indexer unavailable') },
        { status: 503 }
      )
    }

    // Load saved embedding config and update the embedding service
    try {
      const embeddingConfig = await resolveEmbeddingConfig(container, { defaultValue: null })
      if (embeddingConfig) {
        const embeddingService = container.resolve<EmbeddingService>('vectorEmbeddingService')
        embeddingService.updateConfig(embeddingConfig)
        searchDebug('search.embeddings.reindex', 'using embedding config', {
          providerId: embeddingConfig.providerId,
          model: embeddingConfig.model,
          dimension: embeddingConfig.dimension,
        })
      }
    } catch (err) {
      searchDebugWarn('search.embeddings.reindex', 'failed to load embedding config, using defaults', {
        error: err instanceof Error ? err.message : err,
      })
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

    // Use queue-based vector reindexing (similar to fulltext)
    // This enqueues batches for background processing by workers
    let result
    if (entityId) {
      result = await searchIndexer.reindexEntityToVector({
        entityId: entityId as EntityId,
        tenantId: auth.tenantId,
        organizationId: auth.orgId ?? null,
        purgeFirst,
        useQueue: true,
      })
    } else {
      result = await searchIndexer.reindexAllToVector({
        tenantId: auth.tenantId,
        organizationId: auth.orgId ?? null,
        purgeFirst,
        useQueue: true,
      })
    }

    await recordIndexerLog(
      { em: em ?? undefined },
      {
        source: 'vector',
        handler: 'api:search.embeddings.reindex',
        message: result.jobsEnqueued
          ? `Vector reindex enqueued ${result.jobsEnqueued} jobs for ${entityId ?? 'all entities'}`
          : `Vector reindex completed for ${entityId ?? 'all entities'}`,
        entityType: entityId ?? null,
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
        details: {
          purgeFirst,
          recordsIndexed: result.recordsIndexed,
          jobsEnqueued: result.jobsEnqueued,
          success: result.success,
        },
      },
    ).catch(() => undefined)

    return NextResponse.json({
      ok: result.success,
      recordsIndexed: result.recordsIndexed,
      jobsEnqueued: result.jobsEnqueued,
      entitiesProcessed: result.entitiesProcessed,
      errors: result.errors.length > 0 ? result.errors : undefined,
    })
  } catch (error: unknown) {
    const err = error as { message?: string; status?: number; statusCode?: number }
    const status = typeof err?.status === 'number'
      ? err.status
      : (typeof err?.statusCode === 'number' ? err.statusCode : 500)
    searchError('search.embeddings.reindex', 'failed', {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
      status,
    })
    return NextResponse.json(
      { error: t('search.api.errors.reindexFailed', 'Vector reindex failed. Please try again or contact support.') },
      { status: status >= 400 ? status : 500 }
    )
  } finally {
    // Do NOT clear lock here - let queue-aware stale detection handle it
    // When the vector queue becomes empty AND lock is older than 2 minutes,
    // getReindexLockStatus() will automatically clear the stale lock

    const disposable = container as unknown as { dispose?: () => Promise<void> }
    if (typeof disposable.dispose === 'function') {
      await disposable.dispose()
    }
  }
}
