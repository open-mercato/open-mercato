import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { FilterQuery } from '@mikro-orm/core'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findAndCountWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SalesQuote } from '../../../../data/entities'
import { resolveWidgetScope, type WidgetScopeContext } from '../utils'
import { extractCustomerName } from '../../../../lib/customerSnapshot'
import { parseDateInput, resolveDateRange, type DatePeriodOption } from '../../../../lib/dateRange'

const querySchema = z.object({
  limit: z.coerce.number().min(1).max(20).default(5),
  datePeriod: z.enum(['last24h', 'last7d', 'last30d', 'custom']).default('last24h'),
  customFrom: z.string().optional(),
  customTo: z.string().optional(),
  tenantId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['dashboards.view', 'sales.widgets.new-quotes'] },
}

type WidgetContext = WidgetScopeContext & {
  limit: number
  datePeriod: DatePeriodOption
  customFrom?: string
  customTo?: string
}

async function resolveContext(
  req: Request,
  translate: (key: string, fallback?: string) => string,
): Promise<WidgetContext> {
  const url = new URL(req.url)
  const rawQuery: Record<string, string> = {}
  for (const [key, value] of url.searchParams.entries()) {
    rawQuery[key] = value
  }
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

function resolveDateRangeOrThrow(
  period: DatePeriodOption,
  customFrom: string | undefined,
  customTo: string | undefined,
  translate: (key: string, fallback?: string) => string,
): { from: Date; to: Date } {
  const parsedFrom = parseDateInput(customFrom)
  const parsedTo = parseDateInput(customTo)
  if (customFrom && !parsedFrom) {
    throw new CrudHttpError(400, { error: translate('sales.errors.invalid_date', 'Invalid date range') })
  }
  if (customTo && !parsedTo) {
    throw new CrudHttpError(400, { error: translate('sales.errors.invalid_date', 'Invalid date range') })
  }
  return resolveDateRange(period, parsedFrom, parsedTo)
}

export async function GET(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const { em, tenantId, organizationIds, limit, datePeriod, customFrom, customTo } = await resolveContext(
      req,
      translate,
    )

    const { from, to } = resolveDateRangeOrThrow(datePeriod, customFrom, customTo, translate)

    const where: FilterQuery<SalesQuote> = {
      tenantId,
      deletedAt: null,
      createdAt: { $gte: from, $lte: to },
    }

    if (Array.isArray(organizationIds)) {
      where.organizationId =
        organizationIds.length === 1 ? organizationIds[0] : { $in: Array.from(new Set(organizationIds)) }
    }

    const [items, total] = await findAndCountWithDecryption(
      em,
      SalesQuote,
      where,
      {
        limit,
        orderBy: { createdAt: 'desc' as const },
      },
      { tenantId },
    )

    const responseItems = items.map((quote) => ({
      id: quote.id,
      quoteNumber: quote.quoteNumber,
      status: quote.status ?? null,
      customerName: extractCustomerName(quote.customerSnapshot) ?? null,
      customerEntityId: quote.customerEntityId ?? null,
      validFrom: quote.validFrom ? quote.validFrom.toISOString() : null,
      validUntil: quote.validUntil ? quote.validUntil.toISOString() : null,
      netAmount: quote.grandTotalNetAmount,
      grossAmount: quote.grandTotalGrossAmount,
      currency: quote.currencyCode ?? null,
      createdAt: quote.createdAt.toISOString(),
      convertedOrderId: quote.convertedOrderId ?? null,
    }))

    return NextResponse.json({
      items: responseItems,
      total,
      dateRange: {
        from: from.toISOString(),
        to: to.toISOString(),
      },
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('sales.widgets.newQuotes failed', err)
    return NextResponse.json(
      { error: translate('sales.widgets.newQuotes.error', 'Failed to load recent quotes') },
      { status: 500 },
    )
  }
}

const quoteItemSchema = z.object({
  id: z.string().uuid(),
  quoteNumber: z.string(),
  status: z.string().nullable(),
  customerName: z.string().nullable(),
  customerEntityId: z.string().uuid().nullable(),
  validFrom: z.string().nullable(),
  validUntil: z.string().nullable(),
  netAmount: z.string(),
  grossAmount: z.string(),
  currency: z.string().nullable(),
  createdAt: z.string(),
  convertedOrderId: z.string().uuid().nullable(),
})

const responseSchema = z.object({
  items: z.array(quoteItemSchema),
  total: z.number(),
  dateRange: z.object({
    from: z.string(),
    to: z.string(),
  }),
})

const widgetErrorSchema = z.object({
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Sales',
  summary: 'New quotes widget',
  methods: {
    GET: {
      summary: 'Fetch recently created sales quotes',
      description: 'Returns the most recent sales quotes within the scoped tenant/organization.',
      query: querySchema,
      responses: [
        { status: 200, description: 'Widget payload', schema: responseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid query parameters', schema: widgetErrorSchema },
        { status: 401, description: 'Unauthorized', schema: widgetErrorSchema },
        { status: 500, description: 'Widget failed to load', schema: widgetErrorSchema },
      ],
    },
  },
}
