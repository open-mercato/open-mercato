import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { CustomEntity } from '@open-mercato/core/modules/custom_fields/data/entities'

export const metadata = {
  DELETE: { requireAuth: true, requireRoles: ['admin'] },
}

export default async function handler(req: Request) {
  const auth = getAuthFromRequest(req)
  if (!auth || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const entityId = body?.entityId
  if (!entityId) return NextResponse.json({ error: 'entityId is required' }, { status: 400 })

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any

  const where: any = { entityId, organizationId: auth.orgId ?? null, tenantId: auth.tenantId ?? null }
  const ent = await em.findOne(CustomEntity, where)
  if (!ent) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  ent.isActive = false
  ent.updatedAt = new Date()
  ent.deletedAt = ent.deletedAt ?? new Date()
  em.persist(ent)
  await em.flush()
  return NextResponse.json({ ok: true })
}

