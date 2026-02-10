import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { FilterQuery } from '@mikro-orm/core'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SalesOrder } from '../../../../data/entities'
import { extractCustomerName, resolveDateRange, type DatePeriodOption } from '../helpers'
import { resolveWidgetScope, type WidgetScopeContext } from '../utils'

const querySchema = z.object({
  limit: z.coerce.number().min(1).max(20).default(5),
  datePeriod: z.enum(['last24h', 'last7d', 'last30d', 'custom']).default('last24h'),
  customFrom: z.string().optional(),
  customTo: z.string().optional(),
  tenantId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['dashboards.view', 'sales.widgets.new-orders'] },
}

type WidgetContext = WidgetScopeContext & {
  limit: number
  datePeriod: DatePeriodOption
  customFrom?: string
  customTo?: string
}

async function resolveContext(req: Request, translate: (key: string, fallback?: string) => string): Promise<WidgetContext> {
  const url = new URL(req.url)
  const rawQuery: Record<string, string> = {}
  for (const [key, value] of url.searchParams.entries()) rawQuery[key] = value
  const parsed = querySchema.safeParse(rawQuery)
  if (!parsed.success) {
    throw new CrudHttpError(400, { error: translate('sales.errors.invalid_query', 'Invalid query parameters') })
  }

  const { container, em, tenantId, organizationIds } = await resolveWidgetScope(req, translate, {
    tenantId: parsed.data.tenantId ?? null,
    organizationId: parsed.data.organizationId ?? null,
  })

  return {
    container,
    em,
    tenantId,
    organizationIds,
    limit: parsed.data.limit,
    datePeriod: parsed.data.datePeriod,
    customFrom: parsed.data.customFrom,
    customTo: parsed.data.customTo,
  }
}

export async function GET(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const { em, tenantId, organizationIds, limit, datePeriod, customFrom, customTo } = await resolveContext(req, translate)
    const range = resolveDateRange(datePeriod, customFrom, customTo)

    const where: FilterQuery<SalesOrder> = {
      tenantId,
      deletedAt: null,
      createdAt: { $gte: range.from, $lte: range.to },
    }

    if (Array.isArray(organizationIds)) {
      where.organizationId =
        organizationIds.length === 1 ? organizationIds[0] : { $in: Array.from(new Set(organizationIds)) }
    }

    const organizationScopeId =
      Array.isArray(organizationIds) && organizationIds.length === 1 ? organizationIds[0] : null

    const [orders, total] = await Promise.all([
      findWithDecryption(
        em,
        SalesOrder,
        where,
        { orderBy: { createdAt: 'desc' as const }, limit },
        { tenantId, organizationId: organizationScopeId },
      ),
      em.count(SalesOrder, where),
    ])

    const items = orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status ?? null,
      fulfillmentStatus: order.fulfillmentStatus ?? null,
      paymentStatus: order.paymentStatus ?? null,
      customerName: extractCustomerName(order.customerSnapshot ?? null),
      customerEntityId: order.customerEntityId ?? null,
      netAmount: order.grandTotalNetAmount,
      grossAmount: order.grandTotalGrossAmount,
      currency: order.currencyCode ?? null,
      createdAt: order.createdAt.toISOString(),
    }))

    return NextResponse.json({
      items,
      total,
      dateRange: {
        from: range.from.toISOString(),
        to: range.to.toISOString(),
      },
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('sales.widgets.newOrders failed', err)
    return NextResponse.json(
      { error: translate('sales.widgets.newOrders.error', 'Failed to load orders') },
      { status: 500 },
    )
  }
}

const orderItemSchema = z.object({
  id: z.string().uuid(),
  orderNumber: z.string(),
  status: z.string().nullable(),
  fulfillmentStatus: z.string().nullable(),
  paymentStatus: z.string().nullable(),
  customerName: z.string().nullable(),
  customerEntityId: z.string().uuid().nullable(),
  netAmount: z.string(),
  grossAmount: z.string(),
  currency: z.string().nullable(),
  createdAt: z.string(),
})

const responseSchema = z.object({
  items: z.array(orderItemSchema),
  total: z.number(),
  dateRange: z.object({
    from: z.string(),
    to: z.string(),
  }),
})

const widgetErrorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'Sales',
  summary: 'New orders dashboard widget',
  description: 'Fetches recently created sales orders for the dashboard widget with a configurable date period.',
  methods: {
    GET: {
      summary: 'Fetch recently created sales orders',
      query: querySchema,
      responses: [{ status: 200, description: 'List of recent orders', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid query parameters', schema: widgetErrorSchema },
        { status: 401, description: 'Unauthorized', schema: widgetErrorSchema },
        { status: 403, description: 'Forbidden', schema: widgetErrorSchema },
        { status: 500, description: 'Widget failed to load', schema: widgetErrorSchema },
      ],
    },
  },
}
