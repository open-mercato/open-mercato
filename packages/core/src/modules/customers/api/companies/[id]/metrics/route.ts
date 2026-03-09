import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CustomerEntity,
  CustomerActivity,
  CustomerDealCompanyLink,
  CustomerDeal,
  CustomerBranch,
} from '../../../../data/entities'
import { computeHealthScore } from '../../../../lib/healthScore'
import { computeCrmAlerts } from '../../../../lib/crmAlerts'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SortDir, type QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { EntityId } from '@open-mercato/shared/modules/entities'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.companies.view'] },
}

export async function GET(req: Request, ctx: { params?: { id?: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parse = paramsSchema.safeParse({ id: ctx.params?.id })
  if (!parse.success) return NextResponse.json({ error: 'Invalid company id' }, { status: 400 })

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const em = container.resolve('em') as EntityManager

  const allowedOrgIds = new Set<string>()
  if (scope?.filterIds?.length) scope.filterIds.forEach((oid) => allowedOrgIds.add(oid))
  else if (auth.orgId) allowedOrgIds.add(auth.orgId)

  const decryptionScope = {
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
  }

  const company = await findOneWithDecryption(
    em,
    CustomerEntity,
    {
      id: parse.data.id,
      kind: 'company',
      deletedAt: null,
      ...(auth.tenantId ? { tenantId: auth.tenantId } : {}),
    },
    {},
    decryptionScope,
  )
  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  if (allowedOrgIds.size && company.organizationId && !allowedOrgIds.has(company.organizationId)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  const branchCount = await em.count(CustomerBranch, {
    companyEntityId: company.id,
    deletedAt: null,
  })

  const dealLinks = await findWithDecryption(
    em,
    CustomerDealCompanyLink,
    { company: company.id },
    { populate: ['deal'] },
    decryptionScope,
  )
  const deals = dealLinks
    .map((link) => (typeof link.deal === 'string' ? null : link.deal))
    .filter((deal): deal is CustomerDeal => !!deal && !deal.deletedAt)

  const closedStatuses = new Set(['closed', 'win', 'loose'])
  const openDeals = deals.filter((deal) => !closedStatuses.has(deal.status ?? ''))
  const activeOffers = openDeals.length
  const stalledDeals = openDeals.filter((deal) => {
    if (!deal.expectedCloseAt) return false
    return deal.expectedCloseAt < now
  })
  const advancingDeals = openDeals.length - stalledDeals.length

  const activities = await findWithDecryption(
    em,
    CustomerActivity,
    { entity: company.id },
    { orderBy: { occurredAt: 'desc', createdAt: 'desc' }, limit: 100 },
    decryptionScope,
  )
  const lastActivity = activities.length > 0 ? activities[0] : null
  const lastContactDate = lastActivity?.occurredAt ?? lastActivity?.createdAt ?? null

  const daysSinceLastActivity = lastContactDate
    ? Math.floor((now.getTime() - lastContactDate.getTime()) / (24 * 60 * 60 * 1000))
    : null

  const recentActivities = activities.filter((activity) => {
    const activityDate = activity.occurredAt ?? activity.createdAt
    return activityDate >= thirtyDaysAgo
  })
  const monthlyInteractions = recentActivities.length

  const overdueActivities = activities.filter((activity) => activity.isOverdue)

  // Compute revenue from sales orders via query engine
  let monthlyRevenue = 0
  let averageOrderValue = 0
  let actualOrdersInPeriod = 0
  let expectedOrdersInPeriod = 0
  let daysSinceLastOrder: number | null = null
  let purchaseTrend: 'stable' | 'growing' | 'declining' | null = null

  try {
    const queryEngine = container.resolve('queryEngine') as QueryEngine
    const salesOrderEntityId = 'sales:sales_order' as EntityId
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
    const oneEightyDaysAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000)

    const orderResult = await queryEngine.query<{
      id: string
      grand_total_gross_amount?: string | number | null
      created_at?: string | null
    }>(salesOrderEntityId, {
      tenantId: company.tenantId ?? auth.tenantId ?? null,
      organizationIds: allowedOrgIds.size
        ? Array.from(allowedOrgIds)
        : company.organizationId
          ? [company.organizationId]
          : undefined,
      filters: { customer_entity_id: { $eq: company.id } },
      page: { page: 1, pageSize: 100 },
      sort: [{ field: 'created_at', dir: SortDir.Desc }],
    })

    const allOrders = orderResult.items ?? []
    if (allOrders.length > 0) {
      let totalRevenue = 0
      let recentRevenue = 0
      let previousRevenue = 0
      let lastOrderDate: Date | null = null

      for (const order of allOrders) {
        const amount = typeof order.grand_total_gross_amount === 'string' ? parseFloat(order.grand_total_gross_amount) : (order.grand_total_gross_amount ?? 0)
        if (!Number.isNaN(amount)) {
          totalRevenue += amount
          const orderDate = order.created_at ? new Date(order.created_at) : null
          if (orderDate) {
            if (!lastOrderDate || orderDate > lastOrderDate) lastOrderDate = orderDate
            if (orderDate >= ninetyDaysAgo) recentRevenue += amount
            else if (orderDate >= oneEightyDaysAgo) previousRevenue += amount
          }
        }
      }

      averageOrderValue = allOrders.length > 0 ? Math.round((totalRevenue / allOrders.length) * 100) / 100 : 0
      actualOrdersInPeriod = allOrders.filter((o) => {
        const d = o.created_at ? new Date(o.created_at) : null
        return d && d >= ninetyDaysAgo
      }).length

      const orderDates = allOrders
        .map((o) => (o.created_at ? new Date(o.created_at) : null))
        .filter((d): d is Date => d !== null)
        .sort((a, b) => a.getTime() - b.getTime())
      if (orderDates.length >= 2) {
        const monthSpan = Math.max(1, (orderDates[orderDates.length - 1].getTime() - orderDates[0].getTime()) / (30 * 24 * 60 * 60 * 1000))
        monthlyRevenue = Math.round((totalRevenue / monthSpan) * 100) / 100
        expectedOrdersInPeriod = Math.round(allOrders.length / monthSpan)
      } else if (allOrders.length === 1) {
        monthlyRevenue = totalRevenue
        expectedOrdersInPeriod = 1
      }

      if (lastOrderDate) {
        daysSinceLastOrder = Math.floor((now.getTime() - lastOrderDate.getTime()) / (24 * 60 * 60 * 1000))
      }

      if (previousRevenue === 0 && recentRevenue === 0) purchaseTrend = 'stable'
      else if (previousRevenue === 0) purchaseTrend = 'growing'
      else {
        const ratio = recentRevenue / previousRevenue
        purchaseTrend = ratio > 1.1 ? 'growing' : ratio < 0.9 ? 'declining' : 'stable'
      }
    }
  } catch {
    // Sales module may not be installed — revenue stays at 0
  }

  const healthScore = computeHealthScore({
    daysSinceLastActivity,
    advancingDeals,
    stalledDeals: stalledDeals.length,
    totalOpenDeals: openDeals.length,
    actualOrdersInPeriod,
    expectedOrdersInPeriod,
    monthlyInteractions,
  })

  const alerts = computeCrmAlerts({
    daysSinceLastActivity,
    expectedOrderIntervalDays: expectedOrdersInPeriod > 0 ? Math.round(90 / expectedOrdersInPeriod) : null,
    daysSinceLastOrder,
    stalledDealCount: stalledDeals.length,
    purchaseTrend,
    overdueActivityCount: overdueActivities.length,
  })

  return NextResponse.json({
    monthlyRevenue,
    branchCount,
    activeOffers,
    lastContactDate: lastContactDate ? lastContactDate.toISOString() : null,
    healthScore,
    averageOrderValue,
    alerts,
  })
}

const metricsResponseSchema = z.object({
  monthlyRevenue: z.number(),
  branchCount: z.number(),
  activeOffers: z.number(),
  lastContactDate: z.string().nullable(),
  healthScore: z.object({
    score: z.number(),
    label: z.enum(['excellent', 'good', 'at_risk', 'critical']),
    components: z.object({
      activityRecency: z.number(),
      dealPipelineHealth: z.number(),
      orderFrequency: z.number(),
      interactionCount: z.number(),
    }),
  }),
  averageOrderValue: z.number(),
  alerts: z.array(z.object({
    type: z.string(),
    severity: z.enum(['warning', 'error']),
    tab: z.string().optional(),
  })),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Company metrics & health score',
  methods: {
    GET: {
      summary: 'Fetch company KPI metrics and health score',
      description: 'Returns computed KPIs including monthly revenue, branch count, active offers, health score, and CRM alerts for a company.',
      responses: [
        { status: 200, description: 'Company metrics', schema: metricsResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid identifier', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Access denied', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Company not found', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
