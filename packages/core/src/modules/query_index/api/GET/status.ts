import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { E as AllEntities } from '@/generated/entities.ids.generated'
import { CustomEntity } from '@open-mercato/core/modules/custom_fields/data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'

function toBaseTableFromEntityType(entityType: string): string {
  const [, ent] = (entityType || '').split(':')
  if (!ent) throw new Error(`Invalid entityType: ${entityType}`)
  return ent.endsWith('s') ? ent : `${ent}s`
}

export const metadata = {
  GET: { requireAuth: true, requireRoles: ['admin'] as const },
}

export default async function handler(req: Request) {
  const auth = getAuthFromRequest(req)
  if (!auth || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager
  const knex = (em as any).getConnection().getKnex()
  const orgId = auth.orgId
  const tenantId = auth.tenantId ?? null

  // Generated entities from code
  const generated: { entityId: string; label: string }[] = []
  for (const modId of Object.keys(AllEntities)) {
    const entities = (AllEntities as any)[modId] as Record<string, string>
    for (const k of Object.keys(entities)) {
      const id = entities[k]
      generated.push({ entityId: id, label: id })
    }
  }

  // Custom user-defined entities (active)
  const customs = await em.find(CustomEntity as any, { isActive: true } as any)
  const custom = (customs as any[]).map((c) => ({ entityId: c.entityId as string, label: (c as any).label || c.entityId }))

  // Merge by entityId preferring custom label
  const byId = new Map<string, { entityId: string; label: string }>()
  for (const g of generated) byId.set(g.entityId, g)
  for (const cu of custom) byId.set(cu.entityId, { ...byId.get(cu.entityId), ...cu } as any)

  let entityIds = Array.from(byId.values()).map((x) => x.entityId).sort()

  // Limit to entities that have active custom field definitions in current scope
  try {
    const cfRows = await knex('custom_field_defs')
      .distinct('entity_id')
      .where({ is_active: true })
      .modify((qb: any) => {
        qb.andWhere((b: any) => b.where({ organization_id: orgId }).orWhereNull('organization_id'))
        if (tenantId != null) qb.andWhere((b: any) => b.where({ tenant_id: tenantId }).orWhereNull('tenant_id'))
      })
    const enabled = new Set<string>((cfRows || []).map((r: any) => String(r.entity_id)))
    entityIds = entityIds.filter((id) => enabled.has(id))
  } catch {}

  async function countBase(entityType: string, orgIdParam: string, tenantIdParam: string | null): Promise<number> {
    const table = toBaseTableFromEntityType(entityType)
    const whereScoped = (qb: any) => {
      qb.where((b: any) => b.where({ organization_id: orgIdParam }).orWhereNull('organization_id'))
      if (tenantIdParam != null) qb.andWhere((b: any) => b.where({ tenant_id: tenantIdParam }).orWhereNull('tenant_id'))
      qb.andWhere({ deleted_at: null })
    }
    try {
      const r = await knex(table).modify(whereScoped).count('* as count').first()
      const n = r && (r as any).count != null ? Number((r as any).count) : 0
      return isNaN(n) ? 0 : n
    } catch {
      // Fallback: unscoped count if table lacks org/tenant columns
      try {
        const r = await knex(table).count('* as count').first()
        const n = r && (r as any).count != null ? Number((r as any).count) : 0
        return isNaN(n) ? 0 : n
      } catch {
        return 0
      }
    }
  }

  async function countIndex(entityType: string, orgIdParam: string, tenantIdParam: string | null): Promise<number> {
    try {
      const r = await knex('entity_indexes')
        .where({ entity_type: entityType })
        .modify((qb: any) => {
          qb.andWhere((b: any) => b.where({ organization_id: orgIdParam }).orWhereNull('organization_id'))
          if (tenantIdParam != null) qb.andWhere((b: any) => b.where({ tenant_id: tenantIdParam }).orWhereNull('tenant_id'))
          qb.andWhere({ deleted_at: null })
        })
        .count('* as count')
        .first()
      const n = r && (r as any).count != null ? Number((r as any).count) : 0
      return isNaN(n) ? 0 : n
    } catch {
      return 0
    }
  }

  async function fetchJob(entityType: string, orgIdParam: string): Promise<{ status: 'idle' | 'reindexing' | 'purging'; startedAt?: string | null; finishedAt?: string | null }> {
    try {
      const row = await knex('entity_index_jobs')
        .where({ entity_type: entityType })
        .modify((qb: any) => {
          qb.andWhere((b: any) => b.where({ organization_id: orgIdParam }).orWhereNull('organization_id'))
        })
        .orderBy('started_at', 'desc')
        .first()
      if (!row) return { status: 'idle' }
      const done = row.finished_at != null
      return { status: done ? 'idle' : (row.status as any) || 'reindexing', startedAt: row.started_at, finishedAt: row.finished_at }
    } catch {
      return { status: 'idle' }
    }
  }

  const items: any[] = []
  for (const eid of entityIds) {
    const [baseCount, indexCount, job] = await Promise.all([countBase(eid, orgId, tenantId), countIndex(eid, orgId, tenantId), fetchJob(eid, orgId)])
    const label = (byId.get(eid)?.label) || eid
    items.push({ entityId: eid, label, baseCount, indexCount, ok: baseCount === indexCount, job })
  }

  return NextResponse.json({ items })
}


