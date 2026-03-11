import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CustomerDeal } from '../../../../data/entities'

const querySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

export async function GET(request: Request) {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(request)
  if (!auth?.sub && !auth?.isApiKey) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  let rbac: RbacService | null = null
  try {
    rbac = (container.resolve('rbacService') as RbacService)
  } catch {
    rbac = null
  }

  if (!rbac || !auth?.sub) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }
  const hasFeature = await rbac.userHasAllFeatures(auth.sub, ['customers.analytics.view'], {
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
  })
  if (!hasFeature) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const url = new URL(request.url)
  const queryResult = querySchema.safeParse(Object.fromEntries(url.searchParams))
  if (!queryResult.success) {
    return NextResponse.json({ error: 'Invalid query parameters', details: queryResult.error.flatten() }, { status: 400 })
  }
  const query = queryResult.data

  const now = new Date()
  const dateTo = query.to ? new Date(query.to) : now
  const dateFrom = query.from ? new Date(query.from) : new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())

  const em = (container.resolve('em') as EntityManager)
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request })

  const tableName = em.getMetadata().get(CustomerDeal.name).tableName
  const connection = em.getConnection()

  const rows = await connection.execute(
    `SELECT
       to_char(expected_close_at, 'YYYY-MM') AS month,
       COUNT(*)::int AS deal_count,
       COALESCE(SUM(value_amount), 0)::numeric AS total_value,
       COALESCE(SUM(value_amount * COALESCE(probability, 0) / 100.0), 0)::numeric AS weighted_value
     FROM ${tableName}
     WHERE organization_id = ? AND tenant_id = ? AND created_at >= ? AND created_at <= ?
       AND expected_close_at IS NOT NULL AND deleted_at IS NULL
     GROUP BY to_char(expected_close_at, 'YYYY-MM')
     ORDER BY month ASC`,
    [scope.selectedId, scope.tenantId, dateFrom.toISOString(), dateTo.toISOString()],
  )

  const months = rows.map((row: Record<string, unknown>) => ({
    month: String(row.month),
    dealCount: Number(row.deal_count),
    totalValue: Math.round(Number(row.total_value) * 100) / 100,
    weightedValue: Math.round(Number(row.weighted_value) * 100) / 100,
  }))

  return NextResponse.json({ months })
}

export const metadata = {
  methods: ['GET'],
  requireAuth: true,
  requireFeatures: ['customers.analytics.view'],
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Deal forecast analytics',
  methods: {
    GET: {
      summary: 'Deal forecast analytics',
      description: 'Returns deal forecast grouped by expected close month with total and probability-weighted values.',
      responses: [
        { status: 200, description: 'Monthly forecast with deal counts, total values, and weighted values' },
        { status: 400, description: 'Invalid query parameters' },
        { status: 401, description: 'Authentication required' },
        { status: 403, description: 'Access denied' },
      ],
    },
  },
}
