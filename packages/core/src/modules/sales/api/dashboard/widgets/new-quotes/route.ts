import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { FilterQuery } from '@mikro-orm/core'
import type { CacheStrategy } from '@open-mercato/cache'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { runWithCacheTenant } from '@open-mercato/cache'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findAndCountWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveDateRange } from '@open-mercato/ui/backend/date-range'
import { SalesQuote } from '../../../../data/entities'
import { extractCustomerName, type DatePeriodOption } from '../helpers'
import { resolveWidgetScope, type WidgetScopeContext } from '../../../../../customers/api/dashboard/widgets/utils'

const WIDGET_CACHE_TTL = 120_000
const WIDGET_CACHE_SEGMENT_TTL = 86_400_000
const WIDGET_CACHE_SEGMENT_KEY = 'widget-data:__segment__'
const WIDGET_CACHE_TAGS = ['widget-data', 'widget-data:sales:quotes']
const WIDGET_CACHE_ID = 'sales:new-quotes'

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

type NewQuotesWidgetResponse = {
  items: Array<{
    id: string
    quoteNumber: string
    status: string | null
    customerName: string | null
    customerEntityId: string | null
    validFrom: string | null
    validUntil: string | null
    netAmount: string
    grossAmount: string
    currency: string | null
    createdAt: string
    convertedOrderId: string | null
  }>
  total: number
  dateRange: {
    from: string
    to: string
  }
}

function normalizeOrganizationIds(organizationIds: string[] | null): string[] | null {
  if (organizationIds === null) return null
  const set = new Set(organizationIds)
  return Array.from(set).sort()
}

function buildCacheKey(params: {
  tenantId: string
  organizationIds: string[] | null
  limit: number
  datePeriod: DatePeriodOption
  customFrom?: string
  customTo?: string
}): string {
  const hash = createHash('sha256')
  hash.update(
    JSON.stringify({
      widget: WIDGET_CACHE_ID,
      ...params,
      organizationIds: normalizeOrganizationIds(params.organizationIds),
    })
  )
  return `widget-data:${hash.digest('hex').slice(0, 16)}`
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
    const { container, em, tenantId, organizationIds, limit, datePeriod, customFrom, customTo } = await resolveContext(
      req,
      translate
    )
    const range = (() => {
      if (datePeriod === 'custom') {
        const from = customFrom ? new Date(customFrom) : new Date(0)
        const to = customTo ? new Date(customTo) : new Date()
        return { start: from, end: to }
      }
      const preset = datePeriod === 'last7d' ? 'last_7_days' : datePeriod === 'last30d' ? 'last_30_days' : 'today'
      return resolveDateRange(preset)
    })()

    let cache: CacheStrategy | null = null
    try {
      cache = container.resolve<CacheStrategy>('cache')
    } catch {
      cache = null
    }

    

    const cacheKey = buildCacheKey({ tenantId, organizationIds, limit, datePeriod, customFrom, customTo })
    const tenantScope = tenantId ?? null

    if (cache) {
      try {
        const cached = await runWithCacheTenant(tenantScope, () => cache!.get(cacheKey))
        if (cached && typeof cached === 'object' && 'items' in (cached as object)) {
          return NextResponse.json(cached)
        }
      } catch {
      }
    }

    const where: FilterQuery<SalesQuote> = {
      tenantId,
      deletedAt: null,
      createdAt: { $gte: range.start, $lte: range.end },
    }

    if (Array.isArray(organizationIds)) {
      const unique = Array.from(new Set(organizationIds))
      where.organizationId = unique.length === 1 ? unique[0] : { $in: unique }
    }

    const organizationIdScope = Array.isArray(organizationIds) && organizationIds.length === 1 ? organizationIds[0] : null
    const [quotes, total] = await findAndCountWithDecryption(
      em,
      SalesQuote,
      where,
      {
        limit,
        orderBy: { createdAt: 'desc' as const },
      },
      { tenantId, organizationId: organizationIdScope },
    )

    const items = quotes.map((quote) => ({
      id: quote.id,
      quoteNumber: quote.quoteNumber,
      status: quote.status ?? null,
      customerName: extractCustomerName(quote.customerSnapshot) ?? null,
      customerEntityId: quote.customerEntityId ?? null,
      validFrom: quote.validFrom ? quote.validFrom.toISOString() : null,
      validUntil: quote.validUntil ? quote.validUntil.toISOString() : null,
      netAmount: quote.grandTotalNetAmount ?? '0',
      grossAmount: quote.grandTotalGrossAmount ?? '0',
      currency: quote.currencyCode ?? null,
      createdAt: quote.createdAt.toISOString(),
      convertedOrderId: quote.convertedOrderId ?? null,
    }))

    const response: NewQuotesWidgetResponse = {
      items,
      total,
      dateRange: { from: range.start.toISOString(), to: range.end.toISOString() },
    }

    if (cache) {
      try {
        await runWithCacheTenant(tenantScope, () => cache!.set(cacheKey, response, { ttl: WIDGET_CACHE_TTL, tags: WIDGET_CACHE_TAGS }))
        await runWithCacheTenant(tenantScope, () => cache!.set(
          WIDGET_CACHE_SEGMENT_KEY,
          { updatedAt: response.dateRange.to },
          { ttl: WIDGET_CACHE_SEGMENT_TTL, tags: ['widget-data'] },
        ))
      } catch {
      }
    }

    return NextResponse.json(response)
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('sales.widgets.newQuotes failed', err)
    return NextResponse.json(
      { error: translate('sales.widgets.newQuotes.error', 'Failed to load quotes') },
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

const widgetErrorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'Sales',
  summary: 'New quotes dashboard widget',
  description: 'Fetches recently created sales quotes for the dashboard widget with a configurable date period.',
  methods: {
    GET: {
      summary: 'Fetch recently created sales quotes',
      query: querySchema,
      responses: [{ status: 200, description: 'List of recent quotes', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid query parameters', schema: widgetErrorSchema },
        { status: 401, description: 'Unauthorized', schema: widgetErrorSchema },
        { status: 403, description: 'Forbidden', schema: widgetErrorSchema },
        { status: 500, description: 'Widget failed to load', schema: widgetErrorSchema },
      ],
    },
  },
}
