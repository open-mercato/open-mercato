import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { CustomEntity } from '@open-mercato/core/modules/custom_fields/data/entities'
import { upsertCustomEntitySchema } from '@open-mercato/core/modules/custom_fields/data/validators'

export const metadata = {
  POST: { requireAuth: true, requireRoles: ['admin'] },
}

export default async function handler(req: Request) {
  const auth = getAuthFromRequest(req)
  if (!auth || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const parsed = upsertCustomEntitySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }
  const input = parsed.data

  // Allow overlays for code-defined entities: no collision check.

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any

  // Upsert by entityId + org/tenant scope
  const where: any = { entityId: input.entityId, organizationId: auth.orgId ?? null, tenantId: auth.tenantId ?? null }
  let ent = await em.findOne(CustomEntity, where)
  if (!ent) ent = em.create(CustomEntity, { ...where, createdAt: new Date() })
  ent.label = input.label
  ent.description = input.description ?? null
  ent.isActive = input.isActive ?? true
  ent.labelField = input.labelField ?? ent.labelField ?? null
  ent.defaultEditor = input.defaultEditor ?? ent.defaultEditor ?? null
  ent.showInSidebar = input.showInSidebar ?? ent.showInSidebar ?? false
  ent.updatedAt = new Date()
  
  em.persist(ent)
  await em.flush()
  return NextResponse.json({ ok: true, item: { id: ent.id, entityId: ent.entityId, label: ent.label, description: ent.description ?? undefined } })
}
