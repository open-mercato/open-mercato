import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { runWithCacheTenant, type CacheStrategy } from '@open-mercato/cache'
import { collectCrudCacheStats, purgeCrudCacheSegment } from '@open-mercato/shared/lib/crud/cache-stats'
import {
  configsTag,
  cacheStatsResponseSchema,
  cachePurgeRequestSchema,
  cachePurgeAllResponseSchema,
  cachePurgeSegmentResponseSchema,
  configErrorSchema,
} from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['configs.cache.view'] },
  POST: { requireAuth: true, requireFeatures: ['configs.cache.manage'] },
} as const

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { translate } = await resolveTranslations()

  try {
    const container = await createRequestContainer()
    let cache: CacheStrategy
    try {
      cache = (container.resolve('cache') as CacheStrategy)
    } catch {
      return NextResponse.json(
        { error: translate('configs.cache.unavailable', 'Cache service is unavailable.') },
        { status: 503 },
      )
    }
    const stats = await runWithCacheTenant(auth.tenantId ?? null, () => collectCrudCacheStats(cache))
    return NextResponse.json(stats)
  } catch (error) {
    console.error('[configs.cache] failed to resolve cache stats', error)
    return NextResponse.json(
      { error: translate('configs.cache.unavailable', 'Cache service is unavailable.') },
      { status: 500 },
    )
  }
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { translate } = await resolveTranslations()

  let body: any = null
  try {
    body = await req.json()
  } catch {
    body = null
  }

  const action = typeof body?.action === 'string' ? body.action : 'purgeAll'

  try {
    const container = await createRequestContainer()
    let cache: CacheStrategy
    try {
      cache = (container.resolve('cache') as CacheStrategy)
    } catch {
      return NextResponse.json(
        { error: translate('configs.cache.unavailable', 'Cache service is unavailable.') },
        { status: 503 },
      )
    }
    const tenantScope = auth.tenantId ?? null

    if (action === 'purgeSegment') {
      const segment = typeof body?.segment === 'string' ? body.segment.trim() : ''
      if (!segment) {
        return NextResponse.json(
          { error: translate('configs.cache.purgeError', 'Failed to purge cache segment.') },
          { status: 400 },
        )
      }
      const result = await runWithCacheTenant(tenantScope, () => purgeCrudCacheSegment(cache, segment))
      const stats = await runWithCacheTenant(tenantScope, () => collectCrudCacheStats(cache))
      return NextResponse.json({ action: 'purgeSegment', segment, deleted: result.deleted, stats })
    }

    await runWithCacheTenant(tenantScope, () => cache.clear())
    const stats = await runWithCacheTenant(tenantScope, () => collectCrudCacheStats(cache))
    return NextResponse.json({ action: 'purgeAll', stats })
  } catch (error) {
    console.error('[configs.cache] failed to purge cache', error)
    return NextResponse.json(
      { error: translate('configs.cache.purgeError', 'Failed to purge cache segment.') },
      { status: 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: configsTag,
  summary: 'Cache management',
  methods: {
    GET: {
      summary: 'Get cache statistics',
      description: 'Returns detailed cache statistics including total entries and breakdown by cache segments. Requires cache service to be available.',
      responses: [
        { status: 200, description: 'Cache statistics', schema: cacheStatsResponseSchema },
      ],
      errors: [
        { status: 401, description: 'Unauthorized', schema: configErrorSchema },
        { status: 500, description: 'Failed to resolve cache stats', schema: configErrorSchema },
        { status: 503, description: 'Cache service unavailable', schema: configErrorSchema },
      ],
    },
    POST: {
      summary: 'Purge cache',
      description: 'Purges cache entries. Supports two actions: purgeAll (clears entire cache) or purgeSegment (clears specific segment). Returns updated cache statistics after purge.',
      requestBody: {
        contentType: 'application/json',
        schema: cachePurgeRequestSchema,
      },
      responses: [
        { status: 200, description: 'All cache cleared successfully', schema: cachePurgeAllResponseSchema },
        { status: 200, description: 'Cache segment cleared successfully', schema: cachePurgeSegmentResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid request - missing segment identifier for purgeSegment action', schema: configErrorSchema },
        { status: 401, description: 'Unauthorized', schema: configErrorSchema },
        { status: 500, description: 'Failed to purge cache', schema: configErrorSchema },
        { status: 503, description: 'Cache service unavailable', schema: configErrorSchema },
      ],
    },
  },
}
