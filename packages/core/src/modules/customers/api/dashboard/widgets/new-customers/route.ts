import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CustomerEntity, type CustomerEntityKind } from '../../../../data/entities'
import { resolveWidgetScope, type WidgetScopeContext } from '../utils'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { FilterQuery } from '@mikro-orm/core'

const querySchema = z.object({
  limit: z.coerce.number().min(1).max(20).default(5),
  tenantId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
  kind: z.enum(['person', 'company']).optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['dashboards.view', 'customers.widgets.new-customers'] },
}

type WidgetContext = WidgetScopeContext & {
  limit: number
  kind: CustomerEntityKind | null
}

async function resolveContext(req: Request, translate: (key: string, fallback?: string) => string): Promise<WidgetContext> {
  const url = new URL(req.url)
  const rawQuery: Record<string, string> = {}
  for (const [key, value] of url.searchParams.entries()) {
    rawQuery[key] = value
  }
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
    kind: parsed.data.kind ?? null,
  }
}

export async function GET(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const { em, tenantId, organizationIds, limit, kind } = await resolveContext(req, translate)

    const where: FilterQuery<CustomerEntity> = {
      tenantId,
      deletedAt: null,
    }
    if (Array.isArray(organizationIds)) {
      where.organizationId =
        organizationIds.length === 1 ? organizationIds[0] : { $in: Array.from(new Set(organizationIds)) }
    }
    if (kind) where.kind = kind

    const entities = await em.find(CustomerEntity, where, {
      limit,
      orderBy: { createdAt: 'desc' as const },
    })

    const items = entities.map((entity) => ({
      id: entity.id,
      displayName: entity.displayName,
      kind: entity.kind,
      organizationId: entity.organizationId,
      createdAt: entity.createdAt.toISOString(),
      ownerUserId: entity.ownerUserId ?? null,
    }))

    return NextResponse.json({ items })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('customers.widgets.newCustomers failed', err)
    return NextResponse.json(
      { error: translate('customers.widgets.newCustomers.error', 'Failed to load recently added customers') },
      { status: 500 }
    )
  }
}

const newCustomersItemSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().nullable().optional(),
  kind: z.string().nullable().optional(),
  organizationId: z.string().uuid().nullable().optional(),
  createdAt: z.string(),
  ownerUserId: z.string().uuid().nullable().optional(),
})

const newCustomersResponseSchema = z.object({
  items: z.array(newCustomersItemSchema),
})

const widgetErrorSchema = z.object({
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'New customers widget',
  methods: {
    GET: {
      summary: 'Fetch recently created customers',
      description: 'Returns the latest customers created within the scoped tenant/organization for dashboard display.',
      query: querySchema,
      responses: [
        { status: 200, description: 'Widget payload', schema: newCustomersResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid query parameters', schema: widgetErrorSchema },
        { status: 401, description: 'Unauthorized', schema: widgetErrorSchema },
        { status: 500, description: 'Widget failed to load', schema: widgetErrorSchema },
      ],
    },
  },
}
