import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { E as AllEntities } from '@/generated/entities.ids.generated'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveEntityTableName } from '@open-mercato/shared/lib/query/engine'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { queryIndexTag, queryIndexErrorSchema, queryIndexStatusResponseSchema } from './openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['query_index.status.view'] },
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
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

  // Only include code-defined entities in Query Index status.
  // User-defined entities are stored outside the index and should not appear here.
  const byId = new Map<string, { entityId: string; label: string }>()
  for (const g of generated) byId.set(g.entityId, g)

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

  async function columnExists(table: string, column: string): Promise<boolean> {
    try {
      const row = await knex('information_schema.columns')
        .where({ table_name: table, column_name: column })
        .first()
      return !!row
    } catch {
      return false
    }
  }

  async function countBase(entityType: string, tenantIdParam: string | null): Promise<number> {
    // Counts intentionally ignore organization scope. Aggregate across orgs but respect tenant filtering where available.
    const table = resolveEntityTableName(em, entityType)
    const hasTenant = await columnExists(table, 'tenant_id')
    const hasDeleted = await columnExists(table, 'deleted_at')

    let q = knex(table)
    if (hasTenant && tenantIdParam != null) q = q.andWhere((b: any) => b.where({ tenant_id: tenantIdParam }).orWhereNull('tenant_id'))
    if (hasDeleted) q = q.andWhere({ deleted_at: null })

    try {
      const r = await q.count('* as count').first()
      const n = r && (r as any).count != null ? Number((r as any).count) : 0
      return isNaN(n) ? 0 : n
    } catch {
      // Fallback: unscoped count
      try {
        const r = await knex(table).count('* as count').first()
        const n = r && (r as any).count != null ? Number((r as any).count) : 0
        return isNaN(n) ? 0 : n
      } catch {
        return 0
      }
    }
  }

  async function countIndex(entityType: string, tenantIdParam: string | null): Promise<number> {
    try {
      const r = await knex('entity_indexes')
        .where({ entity_type: entityType })
        .modify((qb: any) => {
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

  async function fetchJob(entityType: string, tenantIdParam: string | null): Promise<{ status: 'idle' | 'reindexing' | 'purging'; startedAt?: string | null; finishedAt?: string | null }> {
    try {
      const row = await knex('entity_index_jobs')
        .where({ entity_type: entityType })
        .modify((qb: any) => {
          if (tenantIdParam != null) qb.andWhere((b: any) => b.where({ tenant_id: tenantIdParam }).orWhereNull('tenant_id'))
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
    const [baseCount, indexCount, job] = await Promise.all([countBase(eid, tenantId), countIndex(eid, tenantId), fetchJob(eid, tenantId)])
    const label = (byId.get(eid)?.label) || eid
    items.push({ entityId: eid, label, baseCount, indexCount, ok: baseCount === indexCount, job })
  }

  const response = NextResponse.json({ items })
  const partial = items.find((item) => item.baseCount !== item.indexCount)
  if (partial) {
    response.headers.set(
      'x-om-partial-index',
      JSON.stringify({
        type: 'partial_index',
        entity: partial.entityId,
        baseCount: partial.baseCount,
        indexedCount: partial.indexCount,
        scope: 'global',
      })
    )
  }
  return response
}

const queryIndexStatusDoc: OpenApiMethodDoc = {
  summary: 'Inspect query index coverage',
  description: 'Returns entity counts comparing base tables with the query index along with the latest job status.',
  tags: [queryIndexTag],
  responses: [
    { status: 200, description: 'Current query index status.', schema: queryIndexStatusResponseSchema },
  ],
  errors: [
    { status: 401, description: 'Authentication required', schema: queryIndexErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: queryIndexTag,
  summary: 'Query index status',
  methods: {
    GET: queryIndexStatusDoc,
  },
}
