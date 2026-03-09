import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CustomerEntity } from '../../../../data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SortDir, type QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.companies.view'] },
}

type OrderRecord = {
  id: string
  order_number?: string | null
  grand_total_gross_amount?: string | number | null
  currency_code?: string | null
  status?: string | null
  created_at?: string | null
  customer_entity_id?: string | null
}

function computePurchaseTrend(
  recentTotal: number,
  previousTotal: number,
): 'stable' | 'growing' | 'declining' {
  if (previousTotal === 0 && recentTotal === 0) return 'stable'
  if (previousTotal === 0) return 'growing'
  const ratio = recentTotal / previousTotal
  if (ratio > 1.1) return 'growing'
  if (ratio < 0.9) return 'declining'
  return 'stable'
}

export async function GET(req: Request, ctx: { params?: { id?: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parse = paramsSchema.safeParse({ id: ctx.params?.id })
  if (!parse.success) return NextResponse.json({ error: 'Invalid company id' }, { status: 400 })

  const url = new URL(req.url)
  const queryParse = querySchema.safeParse({
    page: url.searchParams.get('page') ?? 1,
    pageSize: url.searchParams.get('pageSize') ?? 20,
  })
  const { page, pageSize } = queryParse.success ? queryParse.data : { page: 1, pageSize: 20 }

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

  const queryEngine = container.resolve('queryEngine') as QueryEngine
  const salesOrderEntityId = 'sales:sales_order' as EntityId

  let orders: OrderRecord[] = []
  let totalOrders = 0

  try {
    const result = await queryEngine.query<OrderRecord>(salesOrderEntityId, {
      tenantId: company.tenantId ?? auth.tenantId ?? null,
      organizationIds: allowedOrgIds.size
        ? Array.from(allowedOrgIds)
        : company.organizationId
          ? [company.organizationId]
          : undefined,
      filters: {
        customer_entity_id: { $eq: company.id },
      },
      page: { page, pageSize },
      sort: [{ field: 'created_at', dir: SortDir.Desc }],
    })
    orders = result.items ?? []
    totalOrders = result.total ?? orders.length
  } catch {
    // Sales module may not be installed
  }

  const allOrders: OrderRecord[] = []
  if (totalOrders > 0) {
    try {
      const allResult = await queryEngine.query<OrderRecord>(salesOrderEntityId, {
        tenantId: company.tenantId ?? auth.tenantId ?? null,
        organizationIds: allowedOrgIds.size
          ? Array.from(allowedOrgIds)
          : company.organizationId
            ? [company.organizationId]
            : undefined,
        filters: {
          customer_entity_id: { $eq: company.id },
        },
        page: { page: 1, pageSize: 100 },
        sort: [{ field: 'created_at', dir: SortDir.Desc }],
      })
      allOrders.push(...(allResult.items ?? []))
    } catch {
      // fallback to paginated set
      allOrders.push(...orders)
    }
  }

  const now = new Date()
  const threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
  const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000)

  let totalRevenue = 0
  let recentRevenue = 0
  let previousRevenue = 0
  let lastOrderDate: string | null = null

  for (const order of allOrders) {
    const amount = typeof order.grand_total_gross_amount === 'string' ? parseFloat(order.grand_total_gross_amount) : (order.grand_total_gross_amount ?? 0)
    if (!Number.isNaN(amount)) {
      totalRevenue += amount
      const orderDate = order.created_at ? new Date(order.created_at) : null
      if (orderDate) {
        if (!lastOrderDate || orderDate.toISOString() > lastOrderDate) {
          lastOrderDate = orderDate.toISOString()
        }
        if (orderDate >= threeMonthsAgo) {
          recentRevenue += amount
        } else if (orderDate >= sixMonthsAgo) {
          previousRevenue += amount
        }
      }
    }
  }

  const orderCount = allOrders.length
  const averageOrderValue = orderCount > 0 ? totalRevenue / orderCount : 0

  const orderDates = allOrders
    .map((order) => (order.created_at ? new Date(order.created_at) : null))
    .filter((date): date is Date => date !== null)
    .sort((a, b) => a.getTime() - b.getTime())

  let avgMonthlyRevenue = 0
  let frequency = 0
  if (orderDates.length >= 2) {
    const firstOrder = orderDates[0]
    const lastOrder = orderDates[orderDates.length - 1]
    const monthSpan = Math.max(1, (lastOrder.getTime() - firstOrder.getTime()) / (30 * 24 * 60 * 60 * 1000))
    avgMonthlyRevenue = totalRevenue / monthSpan
    frequency = orderCount / monthSpan
  } else if (orderCount === 1) {
    avgMonthlyRevenue = totalRevenue
    frequency = 1
  }

  const purchaseTrend = computePurchaseTrend(recentRevenue, previousRevenue)

  return NextResponse.json({
    orders: orders.map((order) => ({
      id: order.id,
      orderNumber: order.order_number ?? null,
      totalAmount: order.grand_total_gross_amount ?? null,
      currency: order.currency_code ?? null,
      status: order.status ?? null,
      createdAt: order.created_at ?? null,
    })),
    pagination: {
      page,
      pageSize,
      total: totalOrders,
    },
    topProducts: [],
    summary: {
      avgMonthlyRevenue: Math.round(avgMonthlyRevenue * 100) / 100,
      averageOrderValue: Math.round(averageOrderValue * 100) / 100,
      frequency: Math.round(frequency * 100) / 100,
      lastOrderDate,
      totalOrders: orderCount,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
    },
    purchaseTrend,
  })
}

const purchaseHistoryResponseSchema = z.object({
  orders: z.array(z.object({
    id: z.string(),
    orderNumber: z.string().nullable(),
    totalAmount: z.union([z.string(), z.number()]).nullable(),
    currency: z.string().nullable(),
    status: z.string().nullable(),
    createdAt: z.string().nullable(),
  })),
  pagination: z.object({
    page: z.number(),
    pageSize: z.number(),
    total: z.number(),
  }),
  topProducts: z.array(z.object({
    name: z.string(),
    quantity: z.number(),
    totalSpent: z.number(),
  })),
  summary: z.object({
    avgMonthlyRevenue: z.number(),
    averageOrderValue: z.number(),
    frequency: z.number(),
    lastOrderDate: z.string().nullable(),
    totalOrders: z.number(),
    totalRevenue: z.number(),
  }),
  purchaseTrend: z.enum(['stable', 'growing', 'declining']),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Company purchase history',
  methods: {
    GET: {
      summary: 'Fetch purchase history for a company',
      description: 'Returns order history, top products, and purchase summary metrics for a company customer via the sales module query engine.',
      query: querySchema,
      responses: [
        { status: 200, description: 'Purchase history', schema: purchaseHistoryResponseSchema },
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
