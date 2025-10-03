import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { tableNameFromEntityId } from '@open-mercato/shared/lib/entities/naming'
import { CustomEntity } from '@open-mercato/core/modules/entities/data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'

export const metadata = {
  GET: { requireAuth: true, requireRoles: ['admin'] },
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const entityId = url.searchParams.get('entityId') || ''
  let labelField = url.searchParams.get('labelField') || ''
  const q = url.searchParams.get('q') || ''
  const auth = getAuthFromRequest(req)
  if (!auth || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!entityId) return NextResponse.json({ items: [] })

  const container = await createRequestContainer()
  const qe = container.resolve('queryEngine') as QueryEngine
  const em = container.resolve('em') as EntityManager

  if (!labelField) {
    const cfg = await em.findOne(CustomEntity, {
      entityId,
      $and: [
        { $or: [ { organizationId: auth.orgId ?? undefined as any }, { organizationId: null } ] },
        { $or: [ { tenantId: auth.tenantId ?? undefined as any }, { tenantId: null } ] },
      ],
      isActive: true,
    })
    labelField = (cfg?.labelField as string | undefined) || ''
  }
  if (!labelField) {
    const candidates = ['name','title','code','email']
    const table = tableNameFromEntityId(entityId)
    const knex = (em as any).getConnection().getKnex()
    for (const c of candidates) {
      const exists = await knex('information_schema.columns').where({ table_name: table, column_name: c }).first()
      if (exists) { labelField = c; break }
    }
    if (!labelField) labelField = 'id'
  }
  const filters: any = {}
  if (q) filters[labelField] = { $ilike: `%${q}%` }
  const res = await qe.query(entityId, {
    organizationId: auth.orgId,
    tenantId: auth.tenantId ?? undefined,
    fields: ['id', labelField],
    filters,
    page: { page: 1, pageSize: 50 },
  })
  const items = (res.items || []).map((it: any) => ({ value: String(it.id), label: String(it[labelField] ?? it.id) }))
  return NextResponse.json({ items })
}

