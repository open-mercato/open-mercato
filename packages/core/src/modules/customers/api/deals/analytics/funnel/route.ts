import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CustomerDealStageHistory } from '../../../../data/entities'

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

  const tableName = em.getMetadata().get(CustomerDealStageHistory.name).tableName
  const connection = em.getConnection()

  const rows = await connection.execute(
    `SELECT to_stage_label AS label, COUNT(*)::int AS deal_count
     FROM ${tableName}
     WHERE organization_id = ? AND tenant_id = ? AND created_at >= ? AND created_at <= ?
     GROUP BY to_stage_label
     ORDER BY deal_count DESC`,
    [scope.selectedId, scope.tenantId, dateFrom.toISOString(), dateTo.toISOString()],
  )

  const stages: Array<{ label: string; dealCount: number; conversionRate: number }> = []
  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx]
    const dealCount = Number(row.deal_count)
    const previousCount = idx === 0 ? dealCount : Number(rows[idx - 1].deal_count)
    const conversionRate = previousCount > 0 ? Math.round((dealCount / previousCount) * 10000) / 100 : 0
    stages.push({
      label: row.label,
      dealCount,
      conversionRate,
    })
  }

  return NextResponse.json({ stages })
}

export const metadata = {
  methods: ['GET'],
  requireAuth: true,
  requireFeatures: ['customers.analytics.view'],
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Deal funnel analytics',
  methods: {
    GET: {
      summary: 'Deal funnel analytics',
      description: 'Returns deal stage funnel with entry counts and conversion rates between stages.',
      responses: [
        { status: 200, description: 'Funnel stages with deal counts and conversion rates' },
        { status: 400, description: 'Invalid query parameters' },
        { status: 401, description: 'Authentication required' },
        { status: 403, description: 'Access denied' },
      ],
    },
  },
}
