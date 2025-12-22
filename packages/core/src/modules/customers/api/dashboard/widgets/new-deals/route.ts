import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CustomerDeal } from '../../../../data/entities'
import { resolveWidgetScope, type WidgetScopeContext } from '../utils'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { FilterQuery } from '@mikro-orm/core'

const querySchema = z.object({
  limit: z.coerce.number().min(1).max(20).default(5),
  tenantId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['dashboards.view', 'customers.widgets.new-deals'] },
}

type WidgetContext = WidgetScopeContext & {
  limit: number
}

async function resolveContext(req: Request, translate: (key: string, fallback?: string) => string): Promise<WidgetContext> {
  const url = new URL(req.url)
  const rawQuery: Record<string, string> = {}
  for (const [key, value] of url.searchParams.entries()) rawQuery[key] = value
  const parsed = querySchema.safeParse(rawQuery)
  if (!parsed.success) {
    throw new CrudHttpError(400, { error: translate('customers.errors.invalid_query', 'Invalid query parameters') })
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
  }
}

export async function GET(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const { em, tenantId, organizationIds, limit } = await resolveContext(req, translate)

    const where: FilterQuery<CustomerDeal> = {
      tenantId,
      deletedAt: null,
    }
    if (Array.isArray(organizationIds)) {
      where.organizationId = organizationIds.length === 1 ? organizationIds[0] : { $in: Array.from(new Set(organizationIds)) }
    }

    const deals = await em.find(CustomerDeal, where, {
      limit,
      orderBy: { createdAt: 'desc' as const },
    })

    const items = deals.map((deal) => ({
      id: deal.id,
      title: deal.title,
      status: deal.status,
      organizationId: deal.organizationId,
      createdAt: deal.createdAt.toISOString(),
      ownerUserId: deal.ownerUserId ?? null,
      valueAmount: deal.valueAmount ?? null,
      valueCurrency: deal.valueCurrency ?? null,
    }))

    return NextResponse.json({ items })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('customers.widgets.newDeals failed', err)
    return NextResponse.json(
      { error: translate('customers.widgets.newDeals.error', 'Failed to load recently created deals') },
      { status: 500 },
    )
  }
}

const newDealsItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  organizationId: z.string().uuid().nullable().optional(),
  createdAt: z.string(),
  ownerUserId: z.string().uuid().nullable().optional(),
  valueAmount: z.string().nullable().optional(),
  valueCurrency: z.string().nullable().optional(),
})

const newDealsResponseSchema = z.object({
  items: z.array(newDealsItemSchema),
})

const widgetErrorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'New deals widget',
  methods: {
    GET: {
      summary: 'Fetch recently created deals',
      description: 'Returns the latest deals created within the scoped tenant/organization for dashboard display.',
      query: querySchema,
      responses: [{ status: 200, description: 'Widget payload', schema: newDealsResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid query parameters', schema: widgetErrorSchema },
        { status: 401, description: 'Unauthorized', schema: widgetErrorSchema },
        { status: 500, description: 'Widget failed to load', schema: widgetErrorSchema },
      ],
    },
  },
}
