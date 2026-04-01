/**
 * @deprecated Use /api/customers/interactions instead. This route is maintained
 * as a compatibility bridge per SPEC-046b. Will be removed in a future release.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { createCustomersCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../openapi'
import { CustomerInteraction, CustomerTodoLink } from '../../data/entities'
import { todoLinkWithTodoCreateSchema } from '../../data/validators'
import { resolveCustomerInteractionFeatureFlags } from '../../lib/interactionFeatureFlags'
import { resolveCustomersRequestContext } from '../../lib/interactionRequestContext'
import {
  hydrateCanonicalInteractions,
  loadCustomerSummaries,
} from '../../lib/interactionReadModel'
import {
  CUSTOMER_INTERACTION_TODO_ADAPTER_SOURCE,
  CUSTOMER_INTERACTION_TASK_SOURCE,
} from '../../lib/interactionCompatibility'
import {
  type CustomerTodoRow,
  mapInteractionRecordToTodoRow,
  mapLegacyTodoLinkToRow,
  resolveLegacyTodoDetails,
} from '../../lib/todoCompatibility'

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
  all: z.string().optional(),
  entityId: z.string().uuid().optional(),
})

const todoCreateBodySchema = todoLinkWithTodoCreateSchema.omit({
  tenantId: true,
  organizationId: true,
}).passthrough()

const todoUpdateBodySchema = z
  .object({
    id: z.string().uuid(),
    linkId: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(200).optional(),
    isDone: z.boolean().optional(),
    is_done: z.boolean().optional(),
    customFields: z.record(z.string(), z.unknown()).optional(),
    customValues: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

const todoDeleteBodySchema = z.object({
  id: z.string().uuid(),
  todoId: z.string().uuid().optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.view'] },
  POST: { requireAuth: true, requireFeatures: ['customers.interactions.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['customers.interactions.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['customers.interactions.manage'] },
}

const DEPRECATION_HEADERS = {
  Deprecation: 'true',
  Sunset: 'Tue, 30 Jun 2026 00:00:00 GMT',
  Link: '</api/customers/interactions>; rel="successor-version"',
}

type CanonicalTodoListResult = {
  items: CustomerTodoRow[]
  bridgeIds: Set<string>
}

function resolveGuardUserId(auth: {
  sub?: string | null
  userId?: string | null
  keyId?: string | null
}): string {
  if (typeof auth.sub === 'string' && auth.sub.trim().length > 0) return auth.sub
  if (typeof auth.userId === 'string' && auth.userId.trim().length > 0) return auth.userId
  if (typeof auth.keyId === 'string' && auth.keyId.trim().length > 0) return auth.keyId
  return 'system'
}

function withAdapterHeaders(response: Response): Response {
  const headers = new Headers(response.headers)
  Object.entries(DEPRECATION_HEADERS).forEach(([key, value]) => headers.set(key, value))
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

async function legacyAdaptersDisabledResponse(): Promise<Response> {
  const { translate } = await resolveTranslations()
  return withAdapterHeaders(NextResponse.json(
    {
      error: translate(
        'customers.interactions.legacyAdapters.disabled',
        'This legacy adapter has been disabled. Use /api/customers/interactions instead.',
      ),
    },
    { status: 410 },
  ))
}

function normalizeSearch(value: string | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : null
}

function sortTodoRows(rows: CustomerTodoRow[]): CustomerTodoRow[] {
  return [...rows].sort((left, right) => {
    const leftTime = new Date(left.createdAt).getTime()
    const rightTime = new Date(right.createdAt).getTime()
    if (leftTime === rightTime) {
      return right.id.localeCompare(left.id)
    }
    return rightTime - leftTime
  })
}

function filterTodoRows(rows: CustomerTodoRow[], search: string | null): CustomerTodoRow[] {
  if (!search) return rows
  return rows.filter((row) => {
    const haystack = [
      row.customer.displayName,
      row.todoTitle,
      row.todoDescription,
    ]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join(' ')
      .toLowerCase()
    return haystack.includes(search)
  })
}

function paginateTodoRows(
  rows: CustomerTodoRow[],
  page: number,
  pageSize: number,
  exportAll: boolean,
): { items: CustomerTodoRow[]; total: number; page: number; pageSize: number; totalPages: number } {
  const total = rows.length
  if (exportAll) {
    return {
      items: rows,
      total,
      page: 1,
      pageSize: total,
      totalPages: 1,
    }
  }
  const start = (page - 1) * pageSize
  return {
    items: rows.slice(start, start + pageSize),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  }
}

function normalizeTodoStatusInput(body: z.infer<typeof todoUpdateBodySchema>): boolean | undefined {
  if (typeof body.isDone === 'boolean') return body.isDone
  if (typeof body.is_done === 'boolean') return body.is_done
  return undefined
}

function collectTodoCustomValues(
  body: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const direct =
    body.customValues && typeof body.customValues === 'object'
      ? { ...(body.customValues as Record<string, unknown>) }
      : {}
  if (body.todoCustom && typeof body.todoCustom === 'object') {
    Object.assign(direct, body.todoCustom as Record<string, unknown>)
  }
  if (body.customFields && typeof body.customFields === 'object') {
    Object.assign(direct, body.customFields as Record<string, unknown>)
  }
  return Object.keys(direct).length > 0 ? direct : undefined
}

async function listLegacyTodoRows(
  em: EntityManager,
  queryEngine: QueryEngine,
  tenantId: string,
  organizationIds: string[] | null,
  entityId: string | undefined,
): Promise<CustomerTodoRow[]> {
  const where: Record<string, unknown> = { tenantId }
  if (organizationIds && organizationIds.length > 0) {
    where.organizationId = { $in: organizationIds }
  }
  if (entityId) {
    where.entity = entityId
  }

  const links = await em.find(CustomerTodoLink, where, {
    populate: ['entity'],
    orderBy: { createdAt: 'desc' },
  })
  const details = await resolveLegacyTodoDetails(
    queryEngine,
    links,
    tenantId,
    organizationIds ?? [],
  )

  return links.map((link) => {
    const source =
      typeof link.todoSource === 'string' && link.todoSource.trim().length > 0
        ? link.todoSource
        : 'example:todo'
    return mapLegacyTodoLinkToRow(
      link,
      details.get(`${source}:${link.todoId}`) ?? null,
    )
  })
}

async function listCanonicalTodoRows(
  em: EntityManager,
  queryEngine: QueryEngine,
  container: { resolve: (name: string) => unknown },
  auth: { tenantId: string | null; orgId: string | null; sub?: string | null; userId?: string | null; keyId?: string | null },
  selectedOrganizationId: string | null,
  organizationIds: string[] | null,
  query: z.infer<typeof querySchema>,
  options?: { includeDeleted?: boolean; source?: string | string[] | null },
): Promise<CanonicalTodoListResult> {
  const where: Record<string, unknown> = {
    tenantId: auth.tenantId,
    interactionType: 'task',
  }
  if (!options?.includeDeleted) {
    where.deletedAt = null
  }
  if (organizationIds && organizationIds.length > 0) {
    where.organizationId = { $in: organizationIds }
  }
  if (query.entityId) {
    where.entity = query.entityId
  }
  if (options?.source) {
    where.source = Array.isArray(options.source) ? { $in: options.source } : options.source
  }

  const interactions = await em.find(CustomerInteraction, where, {
    orderBy: { createdAt: 'desc' },
  })
  const activeInteractions = interactions.filter((interaction) => !interaction.deletedAt)
  const hydrated = await hydrateCanonicalInteractions({
    em,
    container,
    auth,
    selectedOrganizationId,
    interactions: activeInteractions,
  })
  const customerIds = Array.from(
    new Set(
      hydrated
        .map((interaction) => interaction.entityId ?? null)
        .filter((value): value is string => !!value),
    ),
  )
  const customerSummaries = await loadCustomerSummaries(em, customerIds, auth.tenantId, selectedOrganizationId)

  const items = hydrated.map((interaction) =>
    mapInteractionRecordToTodoRow(
      interaction,
      interaction.entityId ? customerSummaries.get(interaction.entityId) ?? null : null,
      {
        todoSource:
          interaction.source === CUSTOMER_INTERACTION_TODO_ADAPTER_SOURCE
            ? CUSTOMER_INTERACTION_TASK_SOURCE
            : CUSTOMER_INTERACTION_TASK_SOURCE,
      },
    ),
  )

  return {
    items,
    bridgeIds: new Set(interactions.map((interaction) => interaction.id)),
  }
}

async function findLegacyTodoLink(
  em: EntityManager,
  target: { linkId?: string; todoId?: string },
): Promise<CustomerTodoLink | null> {
  if (target.linkId) {
    const byLinkId = await em.findOne(CustomerTodoLink, { id: target.linkId }, { populate: ['entity'] })
    if (byLinkId) return byLinkId
  }
  if (target.todoId) {
    return await em.findOne(CustomerTodoLink, { todoId: target.todoId }, { populate: ['entity'] })
  }
  return null
}

async function ensureCanonicalTodoBridge(
  em: EntityManager,
  queryEngine: QueryEngine,
  commandBus: CommandBus,
  commandContext: Parameters<CommandBus['execute']>[1]['ctx'],
  link: CustomerTodoLink,
): Promise<string> {
  const existing = await em.findOne(CustomerInteraction, { id: link.todoId })
  if (existing) return existing.id

  const detailMap = await resolveLegacyTodoDetails(
    queryEngine,
    [link],
    link.tenantId,
    [link.organizationId],
  )
  const source =
    typeof link.todoSource === 'string' && link.todoSource.trim().length > 0
      ? link.todoSource
      : 'example:todo'
  const detail = detailMap.get(`${source}:${link.todoId}`) ?? null
  const entityId = typeof link.entity === 'string' ? link.entity : link.entity.id

  await commandBus.execute('customers.interactions.create', {
    input: {
      id: link.todoId,
      entityId,
      interactionType: 'task',
      title: detail?.title ?? null,
      body: detail?.description ?? null,
      status: detail?.isDone ? 'done' : 'planned',
      scheduledAt: detail?.dueAt ?? null,
      priority: detail?.priority ?? null,
      source: CUSTOMER_INTERACTION_TODO_ADAPTER_SOURCE,
      ...(detail?.customValues ? { customValues: detail.customValues } : {}),
    },
    ctx: commandContext,
  })

  return link.todoId
}

async function resolveCanonicalTodoTargetId(
  em: EntityManager,
  queryEngine: QueryEngine,
  commandBus: CommandBus,
  commandContext: Parameters<CommandBus['execute']>[1]['ctx'],
  target: { todoId?: string; linkId?: string },
): Promise<string> {
  if (target.todoId) {
    const interaction = await em.findOne(CustomerInteraction, { id: target.todoId })
    if (interaction) return interaction.id
  }

  const legacyLink = await findLegacyTodoLink(em, target)
  if (!legacyLink) {
    if (!target.todoId) throw new CrudHttpError(404, { error: 'Todo not found' })
    return target.todoId
  }

  return ensureCanonicalTodoBridge(
    em,
    queryEngine,
    commandBus,
    commandContext,
    legacyLink,
  )
}

export async function GET(request: Request): Promise<Response> {
  try {
    const { auth, em, organizationIds, container, selectedOrganizationId } =
      await resolveCustomersRequestContext(request)
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const flags = await resolveCustomerInteractionFeatureFlags(container, auth.tenantId)
    if (!flags.legacyAdapters) {
      return await legacyAdaptersDisabledResponse()
    }
    const queryEngine = container.resolve('queryEngine') as QueryEngine
    const exportAll = parseBooleanToken(query.all) === true
    const search = normalizeSearch(query.search)

    const mergedRows = flags.unified
      ? (await listCanonicalTodoRows(
          em,
          queryEngine,
          container,
          auth,
          selectedOrganizationId,
          organizationIds,
          query,
        )).items
      : await Promise.all([
        listLegacyTodoRows(em, queryEngine, auth.tenantId, organizationIds, query.entityId),
        listCanonicalTodoRows(
          em,
          queryEngine,
          container,
          auth,
          selectedOrganizationId,
          organizationIds,
          query,
          {
            includeDeleted: true,
            source: CUSTOMER_INTERACTION_TODO_ADAPTER_SOURCE,
          },
        ),
      ]).then(([legacyRows, canonicalRows]) => [
        ...legacyRows.filter((row) => !canonicalRows.bridgeIds.has(row.todoId)),
        ...canonicalRows.items,
      ])

    const filteredRows = filterTodoRows(sortTodoRows(mergedRows), search)
    const paged = paginateTodoRows(filteredRows, query.page, query.pageSize, exportAll)

    return withAdapterHeaders(
      NextResponse.json({
        items: paged.items,
        total: paged.total,
        page: paged.page,
        pageSize: paged.pageSize,
        totalPages: paged.totalPages,
      }),
    )
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return withAdapterHeaders(NextResponse.json(err.body, { status: err.status }))
    }
    if (err instanceof z.ZodError) {
      return withAdapterHeaders(
        NextResponse.json({ error: 'Validation failed', details: err.issues }, { status: 400 }),
      )
    }
    console.error('customers.todos.get failed', err)
    return withAdapterHeaders(
      NextResponse.json({ error: 'Internal server error' }, { status: 500 }),
    )
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { commandContext, container, auth, selectedOrganizationId } = await resolveCustomersRequestContext(request)
    const flags = await resolveCustomerInteractionFeatureFlags(container, auth.tenantId)
    if (!flags.legacyAdapters) {
      return await legacyAdaptersDisabledResponse()
    }
    const commandBus = container.resolve('commandBus') as CommandBus
    const body = todoCreateBodySchema.parse(await readJsonSafe<Record<string, unknown>>(request, {}))
    const guardUserId = resolveGuardUserId(auth)
    const guardResult = await validateCrudMutationGuard(container, {
      tenantId: auth.tenantId,
      organizationId: selectedOrganizationId,
      userId: guardUserId,
      resourceKind: 'customers.todoLink',
      resourceId: body.entityId,
      operation: 'create',
      requestMethod: request.method,
      requestHeaders: request.headers,
      mutationPayload: body,
    })
    if (guardResult && !guardResult.ok) {
      return withAdapterHeaders(NextResponse.json(guardResult.body, { status: guardResult.status }))
    }
    const customValues = collectTodoCustomValues(body as Record<string, unknown>)

    const { result } = await commandBus.execute('customers.interactions.create', {
      input: {
        entityId: body.entityId,
        interactionType: 'task',
        title: body.title,
        status: body.is_done === true || body.isDone === true ? 'done' : 'planned',
        source: CUSTOMER_INTERACTION_TODO_ADAPTER_SOURCE,
        ...(customValues ? {
          customValues,
          priority: typeof customValues.priority === 'number' ? customValues.priority : null,
          body: typeof customValues.description === 'string' ? customValues.description : null,
          scheduledAt:
            typeof customValues.due_at === 'string'
              ? customValues.due_at
              : typeof customValues.dueAt === 'string'
                ? customValues.dueAt
                : null,
        } : {}),
      },
      ctx: commandContext,
    })
    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(container, {
        tenantId: auth.tenantId,
        organizationId: selectedOrganizationId,
        userId: guardUserId,
        resourceKind: 'customers.todoLink',
        resourceId: body.entityId,
        operation: 'create',
        requestMethod: request.method,
        requestHeaders: request.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    const interactionId =
      result &&
      typeof result === 'object' &&
      'interactionId' in result &&
      typeof result.interactionId === 'string'
        ? result.interactionId
        : result &&
            typeof result === 'object' &&
            'id' in result &&
            typeof result.id === 'string'
          ? result.id
          : null
    return withAdapterHeaders(
      NextResponse.json(
        {
          linkId: interactionId,
          todoId: interactionId,
        },
        { status: 201 },
      ),
    )
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return withAdapterHeaders(NextResponse.json(err.body, { status: err.status }))
    }
    if (err instanceof z.ZodError) {
      return withAdapterHeaders(
        NextResponse.json({ error: 'Validation failed', details: err.issues }, { status: 400 }),
      )
    }
    console.error('customers.todos.post failed', err)
    return withAdapterHeaders(
      NextResponse.json({ error: 'Internal server error' }, { status: 500 }),
    )
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const { commandContext, container, em, auth, selectedOrganizationId } = await resolveCustomersRequestContext(request)
    const flags = await resolveCustomerInteractionFeatureFlags(container, auth.tenantId)
    if (!flags.legacyAdapters) {
      return await legacyAdaptersDisabledResponse()
    }
    const commandBus = container.resolve('commandBus') as CommandBus
    const queryEngine = container.resolve('queryEngine') as QueryEngine
    const body = todoUpdateBodySchema.parse(await readJsonSafe<Record<string, unknown>>(request, {}))
    const guardUserId = resolveGuardUserId(auth)
    const guardResult = await validateCrudMutationGuard(container, {
      tenantId: auth.tenantId,
      organizationId: selectedOrganizationId,
      userId: guardUserId,
      resourceKind: 'customers.todoLink',
      resourceId: body.linkId ?? body.id,
      operation: 'update',
      requestMethod: request.method,
      requestHeaders: request.headers,
      mutationPayload: body,
    })
    if (guardResult && !guardResult.ok) {
      return withAdapterHeaders(NextResponse.json(guardResult.body, { status: guardResult.status }))
    }
    const interactionId = flags.unified
      ? body.id
      : await resolveCanonicalTodoTargetId(
          em,
          queryEngine,
          commandBus,
          commandContext,
          {
            todoId: body.id,
            linkId: body.linkId,
          },
        )
    const customValues = collectTodoCustomValues(body as Record<string, unknown>)
    const nextDone = normalizeTodoStatusInput(body)

    await commandBus.execute('customers.interactions.update', {
      input: {
        id: interactionId,
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(nextDone !== undefined ? { status: nextDone ? 'done' : 'planned' } : {}),
        ...(customValues ? {
          customValues,
          priority: typeof customValues.priority === 'number' ? customValues.priority : null,
          body: typeof customValues.description === 'string' ? customValues.description : null,
          scheduledAt:
            typeof customValues.due_at === 'string'
              ? customValues.due_at
              : typeof customValues.dueAt === 'string'
                ? customValues.dueAt
                : null,
        } : {}),
      },
      ctx: commandContext,
    })
    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(container, {
        tenantId: auth.tenantId,
        organizationId: selectedOrganizationId,
        userId: guardUserId,
        resourceKind: 'customers.todoLink',
        resourceId: body.linkId ?? body.id,
        operation: 'update',
        requestMethod: request.method,
        requestHeaders: request.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    return withAdapterHeaders(NextResponse.json({ ok: true }))
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return withAdapterHeaders(NextResponse.json(err.body, { status: err.status }))
    }
    if (err instanceof z.ZodError) {
      return withAdapterHeaders(
        NextResponse.json({ error: 'Validation failed', details: err.issues }, { status: 400 }),
      )
    }
    console.error('customers.todos.put failed', err)
    return withAdapterHeaders(
      NextResponse.json({ error: 'Internal server error' }, { status: 500 }),
    )
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const { commandContext, container, em, auth, selectedOrganizationId } = await resolveCustomersRequestContext(request)
    const flags = await resolveCustomerInteractionFeatureFlags(container, auth.tenantId)
    if (!flags.legacyAdapters) {
      return await legacyAdaptersDisabledResponse()
    }
    const commandBus = container.resolve('commandBus') as CommandBus
    const queryEngine = container.resolve('queryEngine') as QueryEngine
    const body = todoDeleteBodySchema.parse(await readJsonSafe<Record<string, unknown>>(request, {}))
    const guardUserId = resolveGuardUserId(auth)
    const guardResult = await validateCrudMutationGuard(container, {
      tenantId: auth.tenantId,
      organizationId: selectedOrganizationId,
      userId: guardUserId,
      resourceKind: 'customers.todoLink',
      resourceId: body.id,
      operation: 'delete',
      requestMethod: request.method,
      requestHeaders: request.headers,
      mutationPayload: body,
    })
    if (guardResult && !guardResult.ok) {
      return withAdapterHeaders(NextResponse.json(guardResult.body, { status: guardResult.status }))
    }
    const interactionId = flags.unified
      ? body.todoId ?? body.id
      : await resolveCanonicalTodoTargetId(
          em,
          queryEngine,
          commandBus,
          commandContext,
          {
            linkId: body.id,
            todoId: body.todoId ?? body.id,
          },
        )

    await commandBus.execute('customers.interactions.delete', {
      input: { id: interactionId },
      ctx: commandContext,
    })
    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(container, {
        tenantId: auth.tenantId,
        organizationId: selectedOrganizationId,
        userId: guardUserId,
        resourceKind: 'customers.todoLink',
        resourceId: body.id,
        operation: 'delete',
        requestMethod: request.method,
        requestHeaders: request.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    return withAdapterHeaders(NextResponse.json({ ok: true }))
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return withAdapterHeaders(NextResponse.json(err.body, { status: err.status }))
    }
    if (err instanceof z.ZodError) {
      return withAdapterHeaders(
        NextResponse.json({ error: 'Validation failed', details: err.issues }, { status: 400 }),
      )
    }
    console.error('customers.todos.delete failed', err)
    return withAdapterHeaders(
      NextResponse.json({ error: 'Internal server error' }, { status: 500 }),
    )
  }
}

const todoItemSchema = z.object({
  id: z.string(),
  todoId: z.string(),
  todoSource: z.string(),
  todoTitle: z.string().nullable(),
  todoIsDone: z.boolean().nullable(),
  todoPriority: z.number().nullable().optional(),
  todoSeverity: z.string().nullable().optional(),
  todoDescription: z.string().nullable().optional(),
  todoDueAt: z.string().nullable().optional(),
  todoCustomValues: z.record(z.string(), z.unknown()).nullable().optional(),
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

const todoCreateResponseSchema = z.object({
  linkId: z.string().uuid().nullable(),
  todoId: z.string().uuid().nullable(),
})

export const openApi: OpenApiRouteDoc = createCustomersCrudOpenApi({
  resourceName: 'CustomerTodo',
  querySchema,
  listResponseSchema: createPagedListResponseSchema(todoItemSchema),
  create: {
    schema: todoCreateBodySchema,
    responseSchema: todoCreateResponseSchema,
    description: 'DEPRECATED (sunset 2026-06-30): Creates a customer task. Use POST /api/customers/interactions instead.',
  },
  update: {
    schema: todoUpdateBodySchema,
    responseSchema: defaultOkResponseSchema,
    description: 'DEPRECATED (sunset 2026-06-30): Updates a customer task. Use PUT /api/customers/interactions instead.',
  },
  del: {
    schema: todoDeleteBodySchema,
    responseSchema: defaultOkResponseSchema,
    description: 'DEPRECATED (sunset 2026-06-30): Deletes a customer task. Use DELETE /api/customers/interactions instead.',
  },
})
