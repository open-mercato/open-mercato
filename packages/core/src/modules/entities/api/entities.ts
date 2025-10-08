import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { CustomEntity, CustomFieldDef } from '@open-mercato/core/modules/entities/data/entities'
import { E as AllEntities } from '@/generated/entities.ids.generated'
import { upsertCustomEntitySchema } from '@open-mercato/core/modules/entities/data/validators'

export const metadata = {
  GET: { requireAuth: true },
  POST: { requireAuth: true, requireFeatures: ['entities.definitions.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['entities.definitions.manage'] },
}

export async function GET(req: Request) {
  const auth = getAuthFromRequest(req)
  if (!auth || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any

  // Generated entities from code
  const generated: { entityId: string; source: 'code'; label: string }[] = []
  for (const modId of Object.keys(AllEntities)) {
    const entities = (AllEntities as any)[modId] as Record<string, string>
    for (const k of Object.keys(entities)) {
      const id = entities[k]
      generated.push({ entityId: id, source: 'code', label: id })
    }
  }

  // Custom user-defined entities (global/org/tenant scoped)
  const where: any = { isActive: true }
  where.$and = [
    { $or: [ { organizationId: auth.orgId ?? undefined as any }, { organizationId: null } ] },
    { $or: [ { tenantId: auth.tenantId ?? undefined as any }, { tenantId: null } ] },
  ]
  const customs = await em.find(CustomEntity as any, where as any, { orderBy: { entityId: 'asc' } as any })
  // Resolve overlay precedence: prefer organization/tenant-specific over global
  const customByEntityId = new Map<string, any>()
  for (const c of customs as any[]) {
    const specificity = (c.organizationId ? 2 : 0) + (c.tenantId ? 1 : 0)
    const prev = customByEntityId.get(c.entityId)
    const prevSpec = prev ? ((prev.organizationId ? 2 : 0) + (prev.tenantId ? 1 : 0)) : -1
    if (!prev || specificity > prevSpec) customByEntityId.set(c.entityId, c)
  }

  const custom = Array.from(customByEntityId.values()).map((c) => ({
    entityId: c.entityId,
    source: 'custom' as const,
    label: c.label,
    description: c.description ?? undefined,
    labelField: (c as any).labelField ?? undefined,
    defaultEditor: (c as any).defaultEditor ?? undefined,
    showInSidebar: (c as any).showInSidebar ?? false,
  }))

  const byId = new Map<string, any>()
  for (const g of generated) byId.set(g.entityId, g)
  for (const cu of custom) byId.set(cu.entityId, { ...byId.get(cu.entityId), ...cu })

  // Count field definitions scoped to current tenant/org (same scoping as custom entities)
  const defsWhere: any = { isActive: true }
  defsWhere.$and = [
    //{ $or: [ { organizationId: auth.orgId ?? undefined as any }, { organizationId: null } ] }, // the entities and custom fields are defined per tenant
    { $or: [ { tenantId: auth.tenantId ?? undefined as any }, { tenantId: null } ] },
  ]
  const defs = await em.find(CustomFieldDef as any, defsWhere as any)
  const counts: Record<string, number> = {}
  for (const d of defs as any[]) counts[d.entityId] = (counts[d.entityId] || 0) + 1

  const items = Array.from(byId.values()).map((it: any) => ({ ...it, count: counts[it.entityId] || 0 }))
  return NextResponse.json({ items })
}

export async function POST(req: Request) {
  const auth = getAuthFromRequest(req)
  if (!auth || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const parsed = upsertCustomEntitySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }
  const input = parsed.data

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any

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
  // Invalidate sidebar/nav cache for tenant scope (also when tenantId is null)
  try {
    const cache = (await createRequestContainer()).resolve('cache') as any
    if (cache) {
      await cache.deleteByTags([`nav:entities:${auth.tenantId || 'null'}`])
    }
  } catch {}
  return NextResponse.json({ ok: true, item: { id: ent.id, entityId: ent.entityId, label: ent.label, description: ent.description ?? undefined } })
}

export async function DELETE(req: Request) {
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
  // Invalidate sidebar/nav cache for tenant scope (also when tenantId is null)
  try {
    const cache = (await createRequestContainer()).resolve('cache') as any
    if (cache) {
      await cache.deleteByTags([`nav:entities:${auth.tenantId || 'null'}`])
    }
  } catch {}
  return NextResponse.json({ ok: true })
}

