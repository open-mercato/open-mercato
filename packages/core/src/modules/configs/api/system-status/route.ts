import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { buildSystemStatusSnapshot } from '../../lib/system-status'
import type { SystemStatusRuntime, SystemStatusSnapshot } from '../../lib/system-status.types'
import { runWithCacheTenant, type CacheStrategy } from '@open-mercato/cache'
import { collectCrudCacheStats, purgeCrudCacheSegment } from '@open-mercato/shared/lib/crud/cache-stats'

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
    let runtime: SystemStatusRuntime | undefined

    try {
      const container = await createRequestContainer()
      const cache = container.resolve<CacheStrategy>('cache')
      if (cache && typeof cache.keys === 'function') {
        const crudStats = await runWithCacheTenant(auth.tenantId ?? null, () => collectCrudCacheStats(cache))
        runtime = { crudCache: crudStats }
      }
    } catch {
      runtime = undefined
    }

    if (runtime) {
      return NextResponse.json({ ...snapshot, runtime })
    }
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
  let body: any = null
  try {
    body = await req.json()
  } catch {
    body = null
  }
  const action = typeof body?.action === 'string' ? body.action : 'purgeAll'

  try {
    const container = await createRequestContainer()
    let cache: CacheStrategy | null = null
    try {
      cache = container.resolve<CacheStrategy>('cache')
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

    if (action === 'purgeSegment') {
      const segment = typeof body?.segment === 'string' ? body.segment.trim() : ''
      if (!segment) {
        return NextResponse.json(
          { error: translate('configs.systemStatus.actions.purgeCacheError', 'Failed to purge cache.') },
          { status: 400 }
        )
      }
      const result = await runWithCacheTenant(tenantScope, () => purgeCrudCacheSegment(cache!, segment))
      const stats = await runWithCacheTenant(tenantScope, () => collectCrudCacheStats(cache!))
      return NextResponse.json({ action: 'purgeSegment', segment, deleted: result.deleted, runtime: { crudCache: stats } })
    }

    const cleared = await runWithCacheTenant(tenantScope, () => cache.clear())
    const stats = await runWithCacheTenant(tenantScope, () => collectCrudCacheStats(cache))
    return NextResponse.json({ action: 'purgeAll', cleared, runtime: { crudCache: stats } })
  } catch (error) {
    console.error('[configs.system-status] failed to purge cache', error)
    return NextResponse.json(
      { error: translate('configs.systemStatus.actions.purgeCacheError', 'Failed to purge cache.') },
      { status: 500 }
    )
  }
}
