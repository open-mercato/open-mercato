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
    if (error instanceof Error && /Embedding service unavailable/i.test(error.message)) {
      return NextResponse.json({ error: 'Embedding service unavailable. Configure OPENAI_API_KEY.' }, { status: 503 })
    }
    console.error('[vector.reindex] failed', error)
    return NextResponse.json({ error: 'Vector reindex failed' }, { status: 500 })
  }
}
