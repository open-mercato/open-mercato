import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { CustomEntity, CustomFieldDef } from '@open-mercato/core/modules/custom_fields/data/entities'
import { E as AllEntities } from '@/generated/entities.ids.generated'
import type { EntityManager } from '@mikro-orm/postgresql'

export const metadata = {
  GET: { requireAuth: true, requireRoles: ['admin'] },
}

export default async function handler(req: Request) {
  const auth = getAuthFromRequest(req)
  if (!auth || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager

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
  // Prefer org-specific and tenant-specific when present; but list all active within tenant/org/global
  where.$and = [
    { $or: [ { organizationId: auth.orgId ?? undefined as any }, { organizationId: null } ] },
    { $or: [ { tenantId: auth.tenantId ?? undefined as any }, { tenantId: null } ] },
  ]
  const customs = await em.find(CustomEntity as any, where as any, { orderBy: { entityId: 'asc' } as any })
  const custom = (customs as any[]).map((c) => ({
    entityId: c.entityId,
    source: 'custom' as const,
    label: c.label,
    description: c.description ?? undefined,
    labelField: (c as any).labelField ?? undefined,
    defaultEditor: (c as any).defaultEditor ?? undefined,
  }))

  // Merge by entityId preferring custom label where duplicates exist
  const byId = new Map<string, any>()
  for (const g of generated) byId.set(g.entityId, g)
  for (const cu of custom) byId.set(cu.entityId, { ...byId.get(cu.entityId), ...cu })

  // counts per entity
  const defs = await em.find(CustomFieldDef as any, { isActive: true } as any)
  const counts: Record<string, number> = {}
  for (const d of defs as any[]) counts[d.entityId] = (counts[d.entityId] || 0) + 1

  const items = Array.from(byId.values()).map((it: any) => ({ ...it, count: counts[it.entityId] || 0 }))
  return NextResponse.json({ items })
}
