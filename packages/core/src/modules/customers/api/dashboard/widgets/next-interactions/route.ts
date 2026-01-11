import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CustomerEntity } from '../../../../data/entities'
import type { FilterQuery } from '@mikro-orm/core'
import { resolveWidgetScope, type WidgetScopeContext } from '../utils'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'

const querySchema = z.object({
  limit: z.coerce.number().min(1).max(20).default(5),
  tenantId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
  includePast: z.enum(['true', 'false']).optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['dashboards.view', 'customers.widgets.next-interactions'] },
}

type WidgetContext = WidgetScopeContext & {
  limit: number
  includePast: boolean
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
    includePast: parseBooleanToken(parsed.data.includePast) === true,
  }
}

export async function GET(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const { em, tenantId, organizationIds, limit, includePast } = await resolveContext(req, translate)
    const organizationFilter =
      Array.isArray(organizationIds)
        ? organizationIds.length === 1
          ? organizationIds[0]
          : { $in: Array.from(new Set(organizationIds)) }
        : null

    const now = new Date()

    const filters: FilterQuery<CustomerEntity> = {
      tenantId,
      deletedAt: null,
      nextInteractionAt: includePast ? { $ne: null } : { $gte: now },
    }
    if (organizationFilter) filters.organizationId = organizationFilter

    const entities = await em.find(CustomerEntity, filters, {
      limit,
      orderBy: { nextInteractionAt: 'asc' as const },
    })

    const items = entities.map((entity) => ({
      id: entity.id,
      displayName: entity.displayName,
      kind: entity.kind,
      organizationId: entity.organizationId,
      nextInteractionAt: entity.nextInteractionAt ? entity.nextInteractionAt.toISOString() : null,
      nextInteractionName: entity.nextInteractionName ?? null,
      nextInteractionIcon: entity.nextInteractionIcon ?? null,
      nextInteractionColor: entity.nextInteractionColor ?? null,
      ownerUserId: entity.ownerUserId ?? null,
    }))

    return NextResponse.json({ items, now: now.toISOString() })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('customers.widgets.nextInteractions failed', err)
    return NextResponse.json(
      { error: translate('customers.widgets.nextInteractions.error', 'Failed to load upcoming interactions') },
      { status: 500 }
    )
  }
}

const nextInteractionItemSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().nullable().optional(),
  kind: z.string().nullable().optional(),
  organizationId: z.string().uuid().nullable().optional(),
  nextInteractionAt: z.string().nullable(),
  nextInteractionName: z.string().nullable().optional(),
  nextInteractionIcon: z.string().nullable().optional(),
  nextInteractionColor: z.string().nullable().optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
})

const nextInteractionResponseSchema = z.object({
  items: z.array(nextInteractionItemSchema),
  now: z.string(),
})

const widgetErrorSchema = z.object({
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Next interactions widget',
  methods: {
    GET: {
      summary: 'Fetch upcoming customer interactions',
      description: 'Lists upcoming (or optionally past) customer interaction reminders ordered by interaction date.',
      query: querySchema,
      responses: [
        { status: 200, description: 'Widget payload', schema: nextInteractionResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid query parameters', schema: widgetErrorSchema },
        { status: 401, description: 'Unauthorized', schema: widgetErrorSchema },
        { status: 500, description: 'Widget failed to load', schema: widgetErrorSchema },
      ],
    },
  },
}
