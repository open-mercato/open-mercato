import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import type { VectorIndexService, EmbeddingService } from '@open-mercato/vector'
import { recordIndexerLog } from '@/lib/indexers/status-log'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveEmbeddingConfig } from '../../../lib/embedding-config'

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
        details: { purgeFirst },
      },
    ).catch(() => undefined)
    return NextResponse.json({ ok: true })
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
