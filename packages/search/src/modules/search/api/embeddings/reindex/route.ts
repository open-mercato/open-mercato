import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import type { SearchIndexer } from '../../../../../indexer/search-indexer'
import type { EmbeddingService } from '../../../../../vector'
import { recordIndexerLog } from '@/lib/indexers/status-log'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveEmbeddingConfig } from '../../../lib/embedding-config'
import type { EntityId } from '@open-mercato/shared/modules/entities'

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

    // Use SearchIndexer.reindexEntity or reindexAll which indexes via all strategies
    let result
    if (entityId) {
      result = await searchIndexer.reindexEntity({
        entityId: entityId as EntityId,
        tenantId: auth.tenantId,
        organizationId: auth.orgId ?? null,
        purgeFirst,
      })
    } else {
      result = await searchIndexer.reindexAll({
        tenantId: auth.tenantId,
        organizationId: auth.orgId ?? null,
        purgeFirst,
      })
    }

    await recordIndexerLog(
      { em: em ?? undefined },
      {
        source: 'vector',
        handler: 'api:search.embeddings.reindex',
        message: entityId
          ? `Vector reindex completed for ${entityId}`
          : 'Vector reindex completed for all entities',
        entityType: entityId ?? null,
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
        details: {
          purgeFirst,
          recordsIndexed: result.recordsIndexed,
          success: result.success,
        },
      },
    ).catch(() => undefined)

    return NextResponse.json({
      ok: result.success,
      recordsIndexed: result.recordsIndexed,
      entitiesProcessed: result.entitiesProcessed,
      errors: result.errors.length > 0 ? result.errors : undefined,
    })
  } catch (error: unknown) {
    const err = error as { message?: string; status?: number; statusCode?: number }
    const status = typeof err?.status === 'number'
      ? err.status
      : (typeof err?.statusCode === 'number' ? err.statusCode : 500)
    console.error('[search.embeddings.reindex] failed', {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
      status,
    })
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
