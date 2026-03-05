import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerTodoLink } from '../../data/entities'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createCustomersCrudOpenApi, createPagedListResponseSchema } from '../openapi'
import { decryptEntitiesWithFallbackScope } from '@open-mercato/shared/lib/encryption/subscriber'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
  all: z.string().optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.view'] },
}

const TITLE_FIELDS = ['title', 'subject', 'name', 'summary', 'text'] as const
const IS_DONE_FIELDS = ['is_done', 'isDone', 'done', 'completed'] as const

function resolveTodoTitle(raw: Record<string, unknown>): string | null {
  for (const key of TITLE_FIELDS) {
    const value = raw[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function resolveTodoIsDone(raw: Record<string, unknown>): boolean | null {
  for (const key of IS_DONE_FIELDS) {
    const value = raw[key]
    if (typeof value === 'boolean') return value
  }
  return null
}

async function resolveTodoSummaries(
  queryEngine: QueryEngine,
  links: CustomerTodoLink[],
  tenantId: string | null,
  orgId: string | null,
): Promise<Map<string, { title: string | null; isDone: boolean | null }>> {
  const results = new Map<string, { title: string | null; isDone: boolean | null }>()
  if (!links.length || !tenantId) return results

  const idsBySource = new Map<string, Set<string>>()
  for (const link of links) {
    if (!link.todoSource || !link.todoId) continue
    if (!idsBySource.has(link.todoSource)) idsBySource.set(link.todoSource, new Set())
    idsBySource.get(link.todoSource)!.add(link.todoId)
  }

  const requestedFields = ['id', ...TITLE_FIELDS, ...IS_DONE_FIELDS]
  const organizationIds = orgId ? [orgId] : undefined

  for (const [source, idSet] of idsBySource.entries()) {
    const ids = Array.from(idSet)
    try {
      const result = await queryEngine.query<Record<string, unknown>>(source as EntityId, {
        tenantId,
        organizationIds,
        filters: { id: { $in: ids } },
        fields: requestedFields,
        includeCustomFields: false,
        page: { page: 1, pageSize: Math.max(ids.length, 1) },
      })
      for (const item of result.items ?? []) {
        const raw = item as Record<string, unknown>
        const todoId = typeof raw.id === 'string' ? raw.id : String(raw.id ?? '')
        if (!todoId) continue
        results.set(`${source}:${todoId}`, {
          title: resolveTodoTitle(raw),
          isDone: resolveTodoIsDone(raw),
        })
      }
    } catch {
      // non-critical: todo metadata unavailable, items fall back to null
    }
  }

  return results
}

export async function GET(request: Request): Promise<Response> {
  const auth = await getAuthFromRequest(request)
  if (!auth?.sub && !auth?.isApiKey) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const url = new URL(request.url)
  const parsed = querySchema.safeParse({
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
    search: url.searchParams.get('search') ?? undefined,
    all: url.searchParams.get('all') ?? undefined,
  })

  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'Invalid parameters' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { page, pageSize, search, all } = parsed.data
  const exportAll = parseBooleanToken(all)

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  const where: Record<string, unknown> = {
    tenantId: auth.tenantId,
  }
  if (auth.orgId) {
    where.organizationId = auth.orgId
  }

  if (search?.trim()) {
    where.entity = { displayName: { $ilike: `%${search.trim()}%` } }
  }

  const [links, total] = await em.findAndCount(
    CustomerTodoLink,
    where,
    {
      populate: ['entity'],
      orderBy: { createdAt: 'desc' },
      ...(exportAll ? {} : {
        offset: (page - 1) * pageSize,
        limit: pageSize,
      }),
    },
  )

  await decryptEntitiesWithFallbackScope(links, {
    em,
    tenantId: auth.tenantId,
    organizationId: auth.orgId ?? null,
  })

  const queryEngine = container.resolve('queryEngine') as QueryEngine
  const todoSummaries = await resolveTodoSummaries(queryEngine, links, auth.tenantId, auth.orgId ?? null)

  const effectivePage = exportAll ? 1 : page
  const effectivePageSize = exportAll ? total : pageSize

  const items = links.map((link) => {
    const summary = todoSummaries.get(`${link.todoSource}:${link.todoId}`) ?? null
    return {
      id: link.id,
      todoId: link.todoId,
      todoSource: link.todoSource,
      todoTitle: summary?.title ?? null,
      todoIsDone: summary?.isDone ?? null,
      todoOrganizationId: link.organizationId,
      organizationId: link.organizationId,
      tenantId: link.tenantId,
      createdAt: link.createdAt.toISOString(),
      customer: {
        id: link.entity.id,
        displayName: link.entity.displayName,
        kind: link.entity.kind,
      },
    }
  })

  return new Response(
    JSON.stringify({
      items,
      total,
      page: effectivePage,
      pageSize: effectivePageSize,
      totalPages: exportAll ? 1 : Math.ceil(total / pageSize),
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

const todoItemSchema = z.object({
  id: z.string(),
  todoId: z.string(),
  todoSource: z.string(),
  todoTitle: z.string().nullable(),
  todoIsDone: z.boolean().nullable(),
  todoOrganizationId: z.string().nullable(),
  organizationId: z.string(),
  tenantId: z.string(),
  createdAt: z.string(),
  customer: z.object({
    id: z.string().nullable(),
    displayName: z.string().nullable(),
    kind: z.string().nullable(),
  }),
})

export const openApi: OpenApiRouteDoc = createCustomersCrudOpenApi({
  resourceName: 'CustomerTodo',
  querySchema,
  listResponseSchema: createPagedListResponseSchema(todoItemSchema),
})
