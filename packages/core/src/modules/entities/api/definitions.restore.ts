import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { CustomFieldDef } from '@open-mercato/core/modules/entities/data/entities'

export const metadata = {
  POST: { requireAuth: true, requireRoles: ['admin'] },
}

export async function POST(req: Request) {
  const auth = getAuthFromRequest(req)
  if (!auth || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const { entityId, key } = body || {}
  if (!entityId || !key) return NextResponse.json({ error: 'entityId and key are required' }, { status: 400 })

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any

  const where: any = { entityId, key, organizationId: auth.orgId ?? null, tenantId: auth.tenantId ?? null }
  const def = await em.findOne(CustomFieldDef, where)
  if (!def) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  ;(def as any).deletedAt = null
  ;(def as any).isActive = true
  ;(def as any).updatedAt = new Date()
  em.persist(def)
  await em.flush()
  return NextResponse.json({ ok: true })
}

