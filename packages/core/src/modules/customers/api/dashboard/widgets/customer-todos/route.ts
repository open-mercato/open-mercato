import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CustomerEntity, CustomerTodoLink } from '../../../../data/entities'
import { resolveWidgetScope, type WidgetScopeContext } from '../utils'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { FilterQuery } from '@mikro-orm/core'
import type { EntityId } from '@/modules/entities'

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

type TodoSummary = {
  id: string
  title: string | null
}

function extractTodoTitle(record: Record<string, unknown>): string | null {
  const candidates = ['title', 'subject', 'name', 'summary', 'text', 'description']
  for (const key of candidates) {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }
  return null
}

async function resolveTodoSummaries(
  queryEngine: QueryEngine,
  links: CustomerTodoLink[],
  tenantId: string,
  organizationIds: string[] | null
): Promise<Map<string, TodoSummary>> {
  const results = new Map<string, TodoSummary>()
  if (!links.length) return results

  const idsBySource = new Map<string, Set<string>>()
  for (const link of links) {
    const source = typeof link.todoSource === 'string' && link.todoSource.length > 0 ? link.todoSource : 'unknown'
    const id = String(link.todoId ?? '')
    if (!id) continue
    if (!idsBySource.has(source)) idsBySource.set(source, new Set<string>())
    idsBySource.get(source)!.add(id)
  }

  const scopedOrgIds = Array.isArray(organizationIds)
    ? Array.from(new Set(organizationIds.filter((id) => typeof id === 'string' && id.length > 0)))
    : null

  for (const [source, idSet] of idsBySource.entries()) {
    const ids = Array.from(idSet)
    if (ids.length === 0 || source === 'unknown') continue
    try {
      const queryResult = await queryEngine.query<Record<string, unknown>>(source as EntityId, {
        tenantId,
        organizationIds: scopedOrgIds && scopedOrgIds.length > 0 ? scopedOrgIds : undefined,
        filters: { id: { $in: ids } },
        includeCustomFields: false,
        page: { page: 1, pageSize: Math.max(ids.length, 1) },
      })
      for (const item of queryResult.items ?? []) {
        if (!item || typeof item !== 'object') continue
        const raw = item as Record<string, unknown>
        const todoId = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : String(raw.id ?? '')
        if (!todoId) continue
        const title = extractTodoTitle(raw)
        results.set(`${source}:${todoId}`, { id: todoId, title })
      }
    } catch (err) {
      console.warn(`customers.widgets.todos: failed to resolve todos for source ${source}`, err)
    }
  }

  return results
}

export async function GET(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const { container, em, tenantId, organizationIds, limit } = await resolveContext(req, translate)
    const whereOrganization = Array.isArray(organizationIds)
      ? organizationIds.length === 1
        ? organizationIds[0]
        : { $in: Array.from(new Set(organizationIds)) }
      : null

    const linkFilters: FilterQuery<CustomerTodoLink> = {
      tenantId,
      entity: {
        deletedAt: null,
      } as FilterQuery<CustomerEntity>,
    }
    if (whereOrganization) {
      linkFilters.organizationId = whereOrganization as FilterQuery<CustomerTodoLink>['organizationId']
    }

    const links = await em.find(
      CustomerTodoLink,
      linkFilters,
      {
        limit,
        orderBy: { createdAt: 'desc' },
        populate: ['entity'],
      }
    )

    const queryEngine = (container.resolve('queryEngine') as QueryEngine)
    const todoSummaries = await resolveTodoSummaries(queryEngine, links, tenantId, organizationIds)

    const items = links.map((link) => {
      const entity = link.entity
      const entityRecord = entity && typeof entity !== 'string' ? (entity as CustomerEntity) : null
      const todoKey = `${link.todoSource}:${link.todoId}`
      const summary = todoSummaries.get(todoKey) ?? null
      return {
        id: link.id,
        todoId: link.todoId,
        todoSource: link.todoSource,
        todoTitle: summary?.title ?? null,
        createdAt: link.createdAt.toISOString(),
        organizationId: link.organizationId,
        entity: entityRecord
          ? {
              id: entityRecord.id,
              displayName: entityRecord.displayName,
              kind: entityRecord.kind,
              ownerUserId: entityRecord.ownerUserId,
            }
          : {
              id: typeof entity === 'string' ? entity : null,
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
      summary: 'Fetch recent customer todo links',
      description: 'Returns the most recently created todo links for display on dashboards.',
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
