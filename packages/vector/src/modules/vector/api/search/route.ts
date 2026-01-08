import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { VectorIndexService, EmbeddingService } from '@open-mercato/vector'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveEmbeddingConfig } from '../../lib/embedding-config'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['vector.search'] },
}

function parseLimit(value: string | null): number {
  if (!value) return 10
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed) || parsed <= 0) return 10
  return Math.min(parsed, 50)
}

export async function GET(req: Request) {
  const { t } = await resolveTranslations()
  const url = new URL(req.url)
  const query = (url.searchParams.get('q') || '').trim()
  const limit = parseLimit(url.searchParams.get('limit'))
  if (!query) {
    return NextResponse.json({ error: t('vector.api.errors.missingQuery', 'Missing query') }, { status: 400 })
  }

  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    return NextResponse.json({ error: t('api.errors.unauthorized', 'Unauthorized') }, { status: 401 })
  }

  const container = await createRequestContainer()
  let service: VectorIndexService
  try {
    service = (container.resolve('vectorIndexService') as VectorIndexService)
  } catch {
    return NextResponse.json({ error: t('vector.api.errors.indexUnavailable', 'Vector index unavailable') }, { status: 503 })
  }

  // Load saved embedding config and update the embedding service
  try {
    const embeddingConfig = await resolveEmbeddingConfig(container, { defaultValue: null })
    if (embeddingConfig) {
      const embeddingService = container.resolve<EmbeddingService>('vectorEmbeddingService')
      embeddingService.updateConfig(embeddingConfig)
      console.log('[vector.search] using embedding config', {
        providerId: embeddingConfig.providerId,
        model: embeddingConfig.model,
      })
    }
  } catch (err) {
    console.warn('[vector.search] failed to load embedding config, using defaults', err)
  }

  try {
    const results = await service.search({
      query,
      limit,
      tenantId: auth.tenantId,
      organizationId: auth.orgId ?? null,
    })
    return NextResponse.json({ results })
  } catch (error: any) {
    const message = typeof error?.message === 'string' ? error.message : t('vector.api.errors.searchFailed', 'Vector search failed')
    const status = typeof error?.status === 'number'
      ? error.status
      : (typeof error?.statusCode === 'number' ? error.statusCode : undefined)
    console.error('[vector.search] failed', error)
    return NextResponse.json({ error: message }, { status: status && status >= 400 ? status : 500 })
  }
}
