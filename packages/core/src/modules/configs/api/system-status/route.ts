import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { buildSystemStatusSnapshot } from '../../lib/system-status'
import type { SystemStatusSnapshot } from '../../lib/system-status.types'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { runWithCacheTenant, type CacheStrategy } from '@open-mercato/cache'
import {
  configsTag,
  systemStatusResponseSchema,
  purgeCacheResponseSchema,
  configErrorSchema,
} from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['configs.system_status.view'] },
  POST: { requireAuth: true, requireFeatures: ['configs.manage'] },
} as const

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const snapshot: SystemStatusSnapshot = buildSystemStatusSnapshot()
    return NextResponse.json(snapshot)
  } catch (error) {
    console.error('[configs.system-status] failed to build environment snapshot', error)
    const { translate } = await resolveTranslations()
    return NextResponse.json(
      { error: translate('configs.systemStatus.error', 'Failed to load system status') },
      { status: 500 }
    )
  }
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { translate } = await resolveTranslations()

  try {
    const container = await createRequestContainer()
    let cache: CacheStrategy | null = null
    try {
      cache = (container.resolve('cache') as CacheStrategy)
    } catch {
      cache = null
    }

    if (!cache || typeof cache.clear !== 'function') {
      return NextResponse.json(
        { error: translate('configs.systemStatus.actions.purgeCacheUnavailable', 'Cache service is unavailable.') },
        { status: 503 }
      )
    }

    const tenantScope = auth.tenantId ?? null
    const cleared = await runWithCacheTenant(tenantScope, () => cache.clear())
    return NextResponse.json({ cleared })
  } catch (error) {
    console.error('[configs.system-status] failed to purge cache', error)
    return NextResponse.json(
      { error: translate('configs.systemStatus.actions.purgeCacheError', 'Failed to purge cache.') },
      { status: 500 }
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: configsTag,
  summary: 'System status and health',
  methods: {
    GET: {
      summary: 'Get system health status',
      description: 'Returns comprehensive system health information including environment details, version, resource usage, and service connectivity status.',
      responses: [
        { status: 200, description: 'System status snapshot', schema: systemStatusResponseSchema },
      ],
      errors: [
        { status: 401, description: 'Unauthorized', schema: configErrorSchema },
        { status: 500, description: 'Failed to load system status', schema: configErrorSchema },
      ],
    },
    POST: {
      summary: 'Clear system cache',
      description: 'Purges the entire cache for the current tenant. Useful for troubleshooting or forcing fresh data loading.',
      responses: [
        { status: 200, description: 'Cache cleared successfully', schema: purgeCacheResponseSchema },
      ],
      errors: [
        { status: 401, description: 'Unauthorized', schema: configErrorSchema },
        { status: 503, description: 'Cache service unavailable', schema: configErrorSchema },
        { status: 500, description: 'Failed to purge cache', schema: configErrorSchema },
      ],
    },
  },
}
