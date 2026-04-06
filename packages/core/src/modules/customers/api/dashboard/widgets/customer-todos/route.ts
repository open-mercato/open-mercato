import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveWidgetScope, type WidgetScopeContext } from '../utils'
import { resolveCustomerInteractionFeatureFlags } from '../../../../lib/interactionFeatureFlags'
import { CUSTOMER_INTERACTION_TODO_ADAPTER_SOURCE } from '../../../../lib/interactionCompatibility'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  listLegacyTodoRows,
  listCanonicalTodoRows,
  sortTodoRows,
  type CustomerTodoRow,
} from '../../../../lib/todoCompatibility'

const querySchema = z.object({
  limit: z.coerce.number().min(1).max(20).default(5),
  tenantId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['dashboards.view', 'customers.widgets.todos'] },
}

type WidgetContext = WidgetScopeContext & { limit: number }

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
  }
}

export async function GET(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const { container, em, tenantId, organizationIds, limit } = await resolveContext(req, translate)
    const auth = {
      tenantId,
      orgId: organizationIds?.[0] ?? null,
      sub: 'customers.dashboard.todos',
    }
    const flags = await resolveCustomerInteractionFeatureFlags(container, tenantId)
    const rows = flags.unified
      ? (await listCanonicalTodoRows(
          em,
          container,
          auth,
          organizationIds?.[0] ?? null,
          organizationIds ?? null,
        )).items
      : await Promise.all([
          listLegacyTodoRows(
            em,
            container.resolve('queryEngine') as QueryEngine,
            tenantId,
            organizationIds ?? null,
            undefined,
          ),
          listCanonicalTodoRows(
            em,
            container,
            auth,
            organizationIds?.[0] ?? null,
            organizationIds ?? null,
            {
              includeDeleted: true,
              source: CUSTOMER_INTERACTION_TODO_ADAPTER_SOURCE,
            },
          ),
        ]).then(([legacyRows, canonicalRows]) =>
          sortTodoRows([
            ...legacyRows.filter((row) => !canonicalRows.bridgeIds.has(row.todoId)),
            ...canonicalRows.items,
          ]),
        )

    const items = rows.slice(0, limit).map((row: CustomerTodoRow) => {
      const entity = row.customer ?? null
      return {
        id: row.id,
        todoId: row.todoId,
        todoSource: row.todoSource,
        todoTitle: row.todoTitle ?? null,
        createdAt: row.createdAt,
        organizationId: row.organizationId ?? null,
        _integrations: row._integrations ?? undefined,
        entity: entity?.id
          ? {
              id: entity.id,
              displayName: entity.displayName ?? null,
              kind: entity.kind ?? null,
              ownerUserId: null,
            }
          : {
            id: null,
            displayName: null,
            kind: null,
            ownerUserId: null,
          },
      }
    })

    return NextResponse.json({ items })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('customers.widgets.todos failed', err)
    return NextResponse.json(
      { error: translate('customers.widgets.todos.error', 'Failed to load customer tasks') },
      { status: 500 }
    )
  }
}

const customerTodoWidgetItemSchema = z.object({
  id: z.string().uuid(),
  todoId: z.string().uuid(),
  todoSource: z.string(),
  todoTitle: z.string().nullable().optional(),
  createdAt: z.string(),
  _integrations: z.record(z.string(), z.unknown()).optional(),
  organizationId: z.string().uuid().nullable().optional(),
  entity: z
    .object({
      id: z.string().uuid().nullable(),
      displayName: z.string().nullable(),
      kind: z.string().nullable(),
      ownerUserId: z.string().uuid().nullable().optional(),
    })
    .passthrough(),
})

const customerTodoWidgetResponseSchema = z.object({
  items: z.array(customerTodoWidgetItemSchema),
})

const widgetErrorSchema = z.object({
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Customer todos widget',
  methods: {
    GET: {
      summary: 'Fetch recent customer tasks',
      description: 'Returns the most recent customer tasks for display on dashboards, including legacy compatibility rows when needed.',
      query: querySchema,
      responses: [
        { status: 200, description: 'Widget payload', schema: customerTodoWidgetResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid query parameters', schema: widgetErrorSchema },
        { status: 401, description: 'Unauthorized', schema: widgetErrorSchema },
        { status: 500, description: 'Widget failed to load', schema: widgetErrorSchema },
      ],
    },
  },
}
