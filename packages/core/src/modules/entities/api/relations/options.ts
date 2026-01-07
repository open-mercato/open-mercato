import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { tableNameFromEntityId } from '@open-mercato/shared/lib/entities/naming'
import { CustomEntity } from '@open-mercato/core/modules/entities/data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['entities.definitions.view'] },
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const entityId = url.searchParams.get('entityId') || ''
  let labelField = url.searchParams.get('labelField') || ''
  const q = url.searchParams.get('q') || ''
  const auth = await getAuthFromRequest(req)
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
  if (q) filters[labelField] = { $ilike: `%${escapeLikePattern(q)}%` }
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

const relationOptionsQuerySchema = z.object({
  entityId: z.string().min(1),
  labelField: z.string().optional(),
  q: z.string().optional(),
})

const relationOptionsResponseSchema = z.object({
  items: z.array(
    z.object({
      value: z.string(),
      label: z.string(),
    })
  ),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Entities',
  summary: 'Relation options lookup',
  methods: {
    GET: {
      summary: 'List relation options',
      description: 'Returns up to 50 option entries for populating relation dropdowns, automatically resolving label fields when omitted.',
      query: relationOptionsQuerySchema,
      responses: [
        {
          status: 200,
          description: 'Option list',
          schema: relationOptionsResponseSchema,
        },
        {
          status: 401,
          description: 'Missing authentication',
          schema: z.object({ error: z.string() }),
        },
      ],
    },
  },
}
