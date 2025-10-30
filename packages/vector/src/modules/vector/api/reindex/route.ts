import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import type { VectorIndexService } from '@open-mercato/vector'

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
  const purgeFirst = payload?.purgeFirst !== false

  const container = await createRequestContainer()
  let service: VectorIndexService
  try {
    service = container.resolve<VectorIndexService>('vectorIndexService')
  } catch {
    return NextResponse.json({ error: 'Vector index unavailable' }, { status: 503 })
  }

  try {
    if (entityId) {
      await service.reindexEntity({ entityId, tenantId: auth.tenantId, organizationId: auth.orgId ?? null, purgeFirst })
    } else {
      await service.reindexAll({ tenantId: auth.tenantId, organizationId: auth.orgId ?? null, purgeFirst })
    }
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    const message = typeof error?.message === 'string' ? error.message : 'Vector reindex failed'
    const status = typeof error?.status === 'number'
      ? error.status
      : (typeof error?.statusCode === 'number' ? error.statusCode : undefined)
    console.error('[vector.reindex] failed', error)
    return NextResponse.json({ error: message }, { status: status && status >= 400 ? status : 500 })
  }
}
