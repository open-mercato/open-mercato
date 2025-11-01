import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import type { VectorIndexService } from '@open-mercato/vector'
import { recordIndexerLog } from '@/lib/indexers/status-log'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['vector.reindex'] },
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
    return NextResponse.json({ error: 'Vector index unavailable' }, { status: 503 })
  }

  try {
    await recordIndexerLog(
      { em: em ?? undefined },
      {
        source: 'vector',
        handler: 'api:vector.reindex',
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
        handler: 'api:vector.reindex',
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
    const message = typeof error?.message === 'string' ? error.message : 'Vector reindex failed'
    const status = typeof error?.status === 'number'
      ? error.status
      : (typeof error?.statusCode === 'number' ? error.statusCode : undefined)
    console.error('[vector.reindex] failed', error)
    await recordIndexerLog(
      { em: em ?? undefined },
      {
        source: 'vector',
        handler: 'api:vector.reindex',
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
