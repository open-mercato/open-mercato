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
  from: z.string().optional(),
  to: z.string().optional(),
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
       COALESCE(source, 'unknown') AS source,
       COUNT(*)::int AS deal_count,
       COALESCE(SUM(value_amount), 0)::numeric AS total_value,
       COUNT(*) FILTER (WHERE status = 'win')::int AS won_count
     FROM ${tableName}
     WHERE organization_id = ? AND tenant_id = ? AND created_at >= ? AND created_at <= ?
       AND deleted_at IS NULL
     GROUP BY COALESCE(source, 'unknown')
     ORDER BY deal_count DESC`,
    [scope.organizationId, scope.tenantId, dateFrom.toISOString(), dateTo.toISOString()],
  )

  const sources = rows.map((row: Record<string, unknown>) => {
    const dealCount = Number(row.deal_count)
    const wonCount = Number(row.won_count)
    return {
      source: String(row.source),
      dealCount,
      totalValue: Math.round(Number(row.total_value) * 100) / 100,
      wonCount,
      winRate: dealCount > 0 ? Math.round((wonCount / dealCount) * 10000) / 100 : 0,
    }
  })

  return NextResponse.json({ sources })
}

export const metadata = {
  methods: ['GET'],
  requireAuth: true,
  requireFeatures: ['customers.analytics.view'],
}

export const openApi: OpenApiRouteDoc = {
  get: {
    summary: 'Deal sources analytics',
    description: 'Returns deal analytics grouped by source, including deal counts, total values, and win rates.',
    tags: ['Customers'],
    parameters: [
      { name: 'from', in: 'query', schema: { type: 'string', format: 'date' }, description: 'Start date (defaults to 12 months ago)' },
      { name: 'to', in: 'query', schema: { type: 'string', format: 'date' }, description: 'End date (defaults to today)' },
    ],
    responses: {
      200: { description: 'Sources with deal counts, total values, won counts, and win rates' },
      400: { description: 'Invalid query parameters' },
      401: { description: 'Authentication required' },
      403: { description: 'Access denied' },
    },
  },
}
