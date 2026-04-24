import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { createCustomersCrudOpenApi, createPagedListResponseSchema } from '../../openapi'
import { resolveCustomerInteractionFeatureFlags } from '../../../lib/interactionFeatureFlags'
import { resolveCustomersRequestContext } from '../../../lib/interactionRequestContext'
import { CUSTOMER_INTERACTION_TODO_ADAPTER_SOURCE } from '../../../lib/interactionCompatibility'
import {
  filterTodoRows,
  listCanonicalTodoRows,
  listLegacyTodoRows,
  normalizeTodoSearch,
  paginateTodoRows,
  sortTodoRows,
} from '../../../lib/todoCompatibility'

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
  all: z.string().optional(),
  entityId: z.string().uuid().optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.interaction.view'] },
}

// Per-source fetch cap used when the legacy adapter must merge legacy and
// canonical-bridge rows without DB-side union. Bounds memory on tenants with
// large task history.
const MERGED_TASK_FETCH_CAP = 2000

export async function GET(request: Request): Promise<Response> {
  const { translate } = await resolveTranslations()
  try {
    const { auth, em, organizationIds, container, selectedOrganizationId } =
      await resolveCustomersRequestContext(request)
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const flags = await resolveCustomerInteractionFeatureFlags(container, auth.tenantId)
    const exportAll = parseBooleanToken(query.all) === true
    const search = normalizeTodoSearch(query.search)
    const queryEngine = container.resolve('queryEngine') as QueryEngine

    if (flags.unified) {
      const canonical = await listCanonicalTodoRows(
        em,
        container,
        auth,
        selectedOrganizationId,
        organizationIds,
        {
          entityId: query.entityId,
          pagination: exportAll ? null : { page: query.page, pageSize: query.pageSize },
          searchText: search,
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

    const legacyWindow = exportAll
      ? null
      : Math.min(
          MERGED_TASK_FETCH_CAP,
          Math.max(query.pageSize, query.page * query.pageSize + query.pageSize),
        )
    const [legacyRows, canonicalRows] = await Promise.all([
      listLegacyTodoRows(em, queryEngine, auth.tenantId, organizationIds, query.entityId, {
        limit: legacyWindow,
      }),
      listCanonicalTodoRows(
        em,
        container,
        auth,
        selectedOrganizationId,
        organizationIds,
        {
          entityId: query.entityId,
          includeDeleted: true,
          source: CUSTOMER_INTERACTION_TODO_ADAPTER_SOURCE,
          limit: legacyWindow,
        },
      ),
    ])
    const mergedRows = [
      ...legacyRows.filter((row) => !canonicalRows.bridgeIds.has(row.todoId)),
      ...canonicalRows.items,
    ]
    const filteredRows = filterTodoRows(sortTodoRows(mergedRows), search)
    const paged = paginateTodoRows(filteredRows, query.page, query.pageSize, exportAll)

    return NextResponse.json({
      items: paged.items,
      total: paged.total,
      page: paged.page,
      pageSize: paged.pageSize,
      totalPages: paged.totalPages,
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('customers.errors.validationFailed', 'Validation failed'), details: err.issues }, { status: 400 })
    }
    console.error('customers.interaction.tasks.get failed', err)
    return NextResponse.json({ error: translate('customers.errors.internalError', 'Internal server error') }, { status: 500 })
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
