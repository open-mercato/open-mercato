import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CustomerDeal, CustomerDealStageHistory } from '../../../../data/entities'

const querySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  pipelineId: z.string().uuid().optional(),
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

  const historyTable = em.getMetadata().get(CustomerDealStageHistory.name).tableName
  const dealsTable = em.getMetadata().get(CustomerDeal.name).tableName
  const connection = em.getConnection()

  const params: unknown[] = [scope.selectedId, scope.tenantId, dateFrom.toISOString(), dateTo.toISOString()]
  let pipelineFilter = ''
  if (query.pipelineId) {
    pipelineFilter = ` AND d.pipeline_id = ?`
    params.push(query.pipelineId)
  }

  const rows = await connection.execute(
    `SELECT
       h.to_stage_label AS label,
       COUNT(*)::int AS deal_count,
       COALESCE(AVG(h.duration_seconds), 0)::numeric AS avg_duration_seconds
     FROM ${historyTable} h
     INNER JOIN ${dealsTable} d ON d.id = h.deal_id
     WHERE h.organization_id = ? AND h.tenant_id = ? AND h.created_at >= ? AND h.created_at <= ?
       AND h.duration_seconds IS NOT NULL${pipelineFilter}
     GROUP BY h.to_stage_label
     ORDER BY avg_duration_seconds DESC`,
    params,
  )

  const stages = rows.map((row: Record<string, unknown>) => ({
    label: String(row.label),
    avgDays: Math.round((Number(row.avg_duration_seconds) / 86400) * 100) / 100,
    dealCount: Number(row.deal_count),
  }))

  return NextResponse.json({ stages })
}

export const metadata = {
  methods: ['GET'],
  requireAuth: true,
  requireFeatures: ['customers.analytics.view'],
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Deal velocity analytics',
  methods: {
    GET: {
      summary: 'Deal velocity analytics',
      description: 'Returns average time spent in each deal stage, computed from stage transition history.',
      responses: [
        { status: 200, description: 'Stages with average duration in days and deal counts' },
        { status: 400, description: 'Invalid query parameters' },
        { status: 401, description: 'Authentication required' },
        { status: 403, description: 'Access denied' },
      ],
    },
  },
}
