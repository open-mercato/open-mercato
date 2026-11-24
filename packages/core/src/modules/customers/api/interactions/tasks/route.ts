import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { isUnrestrictedOrganizationScope } from '@open-mercato/shared/lib/auth/organizationAccess'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { createCustomersCrudOpenApi, createPagedListResponseSchema } from '../../openapi'
import { resolveCustomerInteractionFeatureFlags } from '../../../lib/interactionFeatureFlags'
import { resolveAuthActorId, resolveCustomersRequestContext } from '../../../lib/interactionRequestContext'
import {
  listCanonicalTodoRows,
  listMergedTodoRows,
  normalizeTodoSearch,
  type TodoListFilters,
  type TodoListSort,
} from '../../../lib/todoCompatibility'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('customers')

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 24 * 60 * 60 * 1000
const OWNER_SELF_TOKEN = 'me'

const dateBoundarySchema = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(new Date(value).getTime()), { message: 'Invalid date' })

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
  all: z.string().optional(),
  entityId: z.string().uuid().optional(),
  status: z.enum(['open', 'done']).optional()
    .describe('`open` keeps tasks in a non-terminal status, `done` keeps completed tasks. Omit for all tasks.'),
  dueFrom: dateBoundarySchema.optional()
    .describe('Inclusive lower bound for the due date (ISO date or date-time). Tasks without a due date are excluded.'),
  dueTo: dateBoundarySchema.optional()
    .describe('Inclusive upper bound for the due date. A date without a time covers that whole day (UTC).'),
  priorityMin: z.coerce.number().int().min(0).max(100).optional(),
  priorityMax: z.coerce.number().int().min(0).max(100).optional(),
  ownerUserId: z.union([z.string().uuid(), z.literal(OWNER_SELF_TOKEN)]).optional()
    .describe('Owner user id, or `me` for the signed-in user.'),
  sortField: z.enum(['createdAt', 'dueAt', 'priority']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
})

type TasksListQuery = z.infer<typeof querySchema>

function resolveDueBefore(value: string): Date {
  if (DATE_ONLY_PATTERN.test(value)) return new Date(new Date(`${value}T00:00:00.000Z`).getTime() + DAY_MS)
  return new Date(new Date(value).getTime() + 1)
}

function resolveTodoListFilters(query: TasksListQuery, resolveActorId: () => string): TodoListFilters {
  return {
    status: query.status ?? null,
    dueFrom: query.dueFrom
      ? new Date(DATE_ONLY_PATTERN.test(query.dueFrom) ? `${query.dueFrom}T00:00:00.000Z` : query.dueFrom)
      : null,
    dueBefore: query.dueTo ? resolveDueBefore(query.dueTo) : null,
    priorityMin: query.priorityMin ?? null,
    priorityMax: query.priorityMax ?? null,
    ownerUserId: query.ownerUserId === OWNER_SELF_TOKEN ? resolveActorId() : query.ownerUserId ?? null,
  }
}

function resolveTodoListSort(query: TasksListQuery): TodoListSort {
  const field = query.sortField ?? 'createdAt'
  return { field, dir: query.sortDir ?? (field === 'dueAt' ? 'asc' : 'desc') }
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.interactions.view'] },
}


export async function GET(request: Request): Promise<Response> {
  const { translate } = await resolveTranslations()
  try {
    const { auth, em, organizationIds, container, selectedOrganizationId, scope } =
      await resolveCustomersRequestContext(request)
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const flags = await resolveCustomerInteractionFeatureFlags(container, auth.tenantId)
    const exportAll = parseBooleanToken(query.all) === true
    const isUnrestricted = isUnrestrictedOrganizationScope({
      isSuperAdmin: auth.isSuperAdmin === true,
      allowedOrganizationIds: scope?.allowedIds,
    })
    if (!isUnrestricted && (!organizationIds || organizationIds.length === 0)) {
      logger.warn('customers.interactions.tasks.list collapsed organization scope', {
        tenantId: auth.tenantId,
        organizationIds,
        selectedId: scope?.selectedId ?? null,
        allowedIdsCount: scope?.allowedIds?.length ?? null,
      })
      return NextResponse.json({
        items: [],
        total: 0,
        page: exportAll ? 1 : query.page,
        pageSize: exportAll ? 0 : query.pageSize,
        totalPages: 1,
      })
    }
    const search = normalizeTodoSearch(query.search)
    const filters = resolveTodoListFilters(query, () => resolveAuthActorId(auth))
    const sort = resolveTodoListSort(query)
    const queryEngine = container.resolve('queryEngine') as QueryEngine

    if (flags.unified && !search) {
      const canonical = await listCanonicalTodoRows(
        em,
        container,
        auth,
        selectedOrganizationId,
        organizationIds,
        {
          entityId: query.entityId,
          pagination: exportAll ? null : { page: query.page, pageSize: query.pageSize },
          isUnrestricted,
          filters,
          sort,
        },
      )
      const total = canonical.total
      return NextResponse.json({
        items: canonical.items,
        total,
        page: exportAll ? 1 : query.page,
        pageSize: exportAll ? canonical.items.length : query.pageSize,
        totalPages: exportAll ? 1 : Math.max(1, Math.ceil(total / query.pageSize)),
      })
    }

    const merged = await listMergedTodoRows(
      em,
      queryEngine,
      container,
      auth,
      selectedOrganizationId,
      organizationIds,
      {
        entityId: query.entityId,
        filters,
        sort,
        search,
        pagination: exportAll ? null : { page: query.page, pageSize: query.pageSize },
        isUnrestricted,
        includeLegacy: !flags.unified,
      },
    )

    return NextResponse.json({
      items: merged.items,
      total: merged.total,
      page: exportAll ? 1 : query.page,
      pageSize: exportAll ? merged.items.length : query.pageSize,
      totalPages: exportAll ? 1 : Math.max(1, Math.ceil(merged.total / query.pageSize)),
      ...(merged.totalIsCapped ? { totalIsCapped: true } : {}),
    })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('customers.errors.validationFailed', 'Validation failed'), details: err.issues }, { status: 400 })
    }
    logger.error('customers.interactions.tasks.get failed', { err })
    return NextResponse.json({ error: translate('customers.errors.internalError', 'Internal server error') }, { status: 500 })
  }
}

const todoItemSchema = z.object({
  id: z.string(),
  todoId: z.string(),
  todoSource: z.string(),
  todoTitle: z.string().nullable(),
  todoIsDone: z.boolean().nullable(),
  todoStatus: z.string().nullable().optional(),
  todoPriority: z.number().nullable().optional(),
  todoSeverity: z.string().nullable().optional(),
  todoDescription: z.string().nullable().optional(),
  todoDueAt: z.string().nullable().optional(),
  todoTimezone: z.string().nullable().optional(),
  todoCustomValues: z.record(z.string(), z.unknown()).nullable().optional(),
  todoOrganizationId: z.string().nullable(),
  todoUpdatedAt: z.string().nullable().optional(),
  todoOwnerUserId: z.string().nullable().optional(),
  organizationId: z.string(),
  tenantId: z.string(),
  createdAt: z.string(),
  externalHref: z.string().nullable().optional(),
  _integrations: z.record(z.string(), z.unknown()).optional(),
  customer: z.object({
    id: z.string().nullable(),
    displayName: z.string().nullable(),
    kind: z.string().nullable(),
  }),
})

export const openApi: OpenApiRouteDoc = createCustomersCrudOpenApi({
  resourceName: 'CustomerTask',
  querySchema,
  listResponseSchema: createPagedListResponseSchema(todoItemSchema),
})
