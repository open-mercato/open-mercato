import { z } from 'zod'
import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import type { EntityManager } from '@mikro-orm/postgresql'

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(20),
    q: z.string().optional(),
    type: z.enum(['port', 'terminal']).optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['fms_locations.ports.view'] },
}

const SORT_FIELD_MAP: Record<string, string> = {
  id: 'id',
  code: 'code',
  name: 'name',
  locode: 'locode',
  type: 'product_type',
  productType: 'product_type',
  city: 'city',
  country: 'country',
  lat: 'lat',
  lng: 'lng',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const em = container.resolve('em') as EntityManager

  const url = new URL(req.url)
  const rawParams = Object.fromEntries(url.searchParams.entries())
  const query = listSchema.parse(rawParams)

  const { page, limit, q, type, sortField, sortDir } = query

  const conditions: string[] = []
  const params: any[] = []

  const allowedOrgIds: string[] = []
  if (scope?.filterIds?.length) {
    scope.filterIds.forEach((id) => {
      if (typeof id === 'string') allowedOrgIds.push(id)
    })
  } else {
    const fallbackOrgId = scope?.selectedId ?? auth.orgId
    if (typeof fallbackOrgId === 'string') {
      allowedOrgIds.push(fallbackOrgId)
    }
  }

  if (allowedOrgIds.length > 0) {
    const placeholders = allowedOrgIds.map(() => '?').join(', ')
    conditions.push(`organization_id IN (${placeholders})`)
    params.push(...allowedOrgIds)
  }

  if (auth.tenantId) {
    conditions.push(`tenant_id = ?`)
    params.push(auth.tenantId)
  }

  conditions.push(`deleted_at IS NULL`)

  if (q && q.trim().length > 0) {
    const term = `%${escapeLikePattern(q.trim())}%`
    conditions.push(`(code ILIKE ? OR name ILIKE ?)`)
    params.push(term, term)
  }

  if (type) {
    conditions.push(`product_type = ?`)
    params.push(type)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const sortColumn = SORT_FIELD_MAP[sortField || 'code'] || 'code'
  const sortDirection = sortDir === 'desc' ? 'DESC' : 'ASC'
  const orderClause = `ORDER BY ${sortColumn} ${sortDirection}`

  const offset = (page - 1) * limit

  const countQuery = `SELECT COUNT(*) as count FROM fms_locations ${whereClause}`
  const countParams = [...params]
  const countResult = await em.getConnection().execute(countQuery, countParams)
  const total = parseInt(countResult[0]?.count || '0', 10)

  const dataQuery = `
    SELECT
      id,
      organization_id,
      tenant_id,
      code,
      name,
      locode,
      product_type,
      port_id,
      lat,
      lng,
      city,
      country,
      created_at,
      updated_at
    FROM fms_locations
    ${whereClause}
    ${orderClause}
    LIMIT ? OFFSET ?
  `
  const dataParams = [...params, limit, offset]

  const items = await em.getConnection().execute(dataQuery, dataParams)

  const transformedItems = items.map((item: any) => ({
    id: item.id,
    code: item.code,
    name: item.name,
    locode: item.locode,
    type: item.product_type,
    portId: item.port_id,
    lat: item.lat,
    lng: item.lng,
    city: item.city,
    country: item.country,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  }))

  return NextResponse.json({
    items: transformedItems,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  })
}
