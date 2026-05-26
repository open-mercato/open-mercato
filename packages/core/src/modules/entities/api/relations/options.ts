import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { tableNameFromEntityId } from '@open-mercato/shared/lib/entities/naming'
import { CustomEntity } from '@open-mercato/core/modules/entities/data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['entities.definitions.view'] },
}

const ALLOWED_ROUTE_CONTEXT_FIELDS = new Set(['kind', 'entity_id', 'product_id'])

export async function GET(req: Request) {
  const url = new URL(req.url)
  const entityId = url.searchParams.get('entityId') || ''
  let labelField = url.searchParams.get('labelField') || ''
  const q = url.searchParams.get('q') || ''
  const ids = Array.from(
    new Set(
      (url.searchParams.get('ids') || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  )
  const routeContextFields = Array.from(
    new Set(
      (url.searchParams.get('routeContextFields') || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => ALLOWED_ROUTE_CONTEXT_FIELDS.has(entry)),
    ),
  )
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId || (!auth.orgId && !auth.isSuperAdmin)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
    const candidates = ['name', 'title', 'code', 'email']
    const table = tableNameFromEntityId(entityId)
    const db = (em as any).getKysely() as any
    for (const c of candidates) {
      const exists = await db
        .selectFrom('information_schema.columns')
        .select('column_name')
        .where('table_name', '=', table)
        .where('column_name', '=', c)
        .executeTakeFirst()
      if (exists) { labelField = c; break }
    }
    if (!labelField) labelField = 'id'
  }
  const filters: Record<string, unknown> = {}
  if (ids.length === 1) filters.id = ids[0]
  else if (ids.length > 1) filters.id = { $in: ids }
  if (q) filters[labelField] = { $ilike: `%${escapeLikePattern(q)}%` }
  const fields = Array.from(new Set(['id', labelField, ...routeContextFields]))
  const res = await qe.query(entityId, {
    tenantId: auth.tenantId ?? undefined,
    ...(auth.orgId ? { organizationId: auth.orgId } : {}),
    fields,
    filters,
    page: { page: 1, pageSize: Math.min(ids.length || 50, 200) },
  })
  const items = (res.items || []).map((it: any) => {
    const routeContext = routeContextFields.reduce<Record<string, unknown>>((acc, field) => {
      if (it[field] !== undefined) {
        acc[field] = it[field]
      }
      return acc
    }, {})
    return {
      value: String(it.id),
      label: String(it[labelField] ?? it.id),
      ...(Object.keys(routeContext).length > 0 ? { routeContext } : {}),
    }
  })
  return NextResponse.json({ items })
}

const relationOptionsQuerySchema = z.object({
  entityId: z.string().min(1),
  labelField: z.string().optional(),
  q: z.string().optional(),
  ids: z.string().optional(),
  routeContextFields: z.string().optional(),
})

const relationOptionsResponseSchema = z.object({
  items: z.array(
    z.object({
      value: z.string(),
      label: z.string(),
      routeContext: z.record(z.string(), z.unknown()).optional(),
    })
  ),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Entities',
  summary: 'Relation options lookup',
  methods: {
    GET: {
      summary: 'List relation options',
      description: 'Returns up to 200 option entries for populating relation dropdowns, automatically resolving label fields when omitted.',
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
