import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { FilterQuery } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { isIdsParamProvided, mergeIdFilter, parseIdsParam } from '@open-mercato/shared/lib/crud/ids'
import { readQueryParamList } from '@open-mercato/shared/lib/crud/query-params'
import { CostCenter } from '../../data/entities'
import { costCenterCreateSchema, costCenterUpdateSchema } from '../../data/validators'
import { createPostingRulesCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../openapi'

// `/api/posting_rules/cost-centers` — no `posting-rules/` subfolder (see
// the spec's API Contracts: module id `posting_rules` + the generator's
// `/api/${modId}/...` template would otherwise double up).
const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['posting_rules.cost_centers.manage'] },
  POST: { requireAuth: true, requireFeatures: ['posting_rules.cost_centers.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['posting_rules.cost_centers.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['posting_rules.cost_centers.manage'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).loose()
type CrudInput = Record<string, unknown>

const crud = makeCrudRoute<CrudInput, CrudInput, Record<string, unknown>>({
  metadata: routeMetadata,
  orm: {
    entity: CostCenter,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  events: {
    module: 'posting_rules',
    entity: 'cost_center',
    persistent: true,
  },
  actions: {
    create: {
      commandId: 'posting_rules.createCostCenter',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { costCenterId: string }).costCenterId) }),
      status: 201,
    },
    update: {
      commandId: 'posting_rules.updateCostCenter',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'posting_rules.deleteCostCenter',
      schema: rawBodySchema,
      mapInput: ({ raw, ctx }) => ({
        id: (((raw as Record<string, unknown>).query as Record<string, unknown> | undefined)?.id
          ?? ((raw as Record<string, unknown>).body as Record<string, unknown> | undefined)?.id) as string | undefined,
        organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? undefined,
        tenantId: ctx.auth?.tenantId ?? undefined,
      }),
      response: () => ({ ok: true }),
    },
  },
})

const listQuerySchema = z.object({
  id: z.uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
  sortField: z.enum(['code', 'name', 'createdAt', 'updatedAt']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  isActive: z.coerce.boolean().optional(),
}).loose()

type CostCenterRow = {
  id: string
  code: string
  name: string
  isActive: boolean
  createdAt: string | null
  updatedAt: string | null
  organizationId: string
  tenantId: string
}

const toRow = (costCenter: CostCenter): CostCenterRow => ({
  id: String(costCenter.id),
  code: String(costCenter.code),
  name: String(costCenter.name),
  isActive: Boolean(costCenter.isActive),
  createdAt: costCenter.createdAt ? costCenter.createdAt.toISOString() : null,
  updatedAt: costCenter.updatedAt ? costCenter.updatedAt.toISOString() : null,
  organizationId: String(costCenter.organizationId),
  tenantId: String(costCenter.tenantId),
})

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId || (!auth.orgId && !auth.isSuperAdmin)) {
    return NextResponse.json({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 1 }, { status: 401 })
  }

  const url = new URL(req.url)
  const parsed = listQuerySchema.safeParse({
    id: url.searchParams.get('id') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
    search: url.searchParams.get('search') ?? undefined,
    sortField: url.searchParams.get('sortField') ?? undefined,
    sortDir: url.searchParams.get('sortDir') ?? undefined,
    isActive: url.searchParams.get('isActive') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 1 }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  // Selected organization, not just `auth.orgId` — see
  // financial-command-implementation-checklist item 3.
  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null

  const { id, page, pageSize, search, sortField, sortDir, isActive } = parsed.data
  let filter: Record<string, unknown> = {
    tenantId: auth.tenantId,
    deletedAt: null,
  }
  if (organizationId) filter.organizationId = organizationId
  if (id) filter.id = id
  const rawIds = readQueryParamList(url.searchParams, 'ids')
  if (isIdsParamProvided(rawIds)) {
    filter = mergeIdFilter(filter, parseIdsParam(rawIds), { idsParamProvided: true })
  }
  if (isActive !== undefined) filter.isActive = isActive
  if (search) {
    filter.$or = [
      { code: { $ilike: `%${escapeLikePattern(search)}%` } },
      { name: { $ilike: `%${escapeLikePattern(search)}%` } },
    ]
  }

  const fieldMap: Record<string, string> = {
    code: 'code',
    name: 'name',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  }
  const orderBy: Record<string, 'ASC' | 'DESC'> = {}
  if (sortField) {
    orderBy[fieldMap[sortField] || 'name'] = sortDir === 'desc' ? 'DESC' : 'ASC'
  } else {
    orderBy.name = 'ASC'
  }

  const offset = (page - 1) * pageSize
  const [rows, total] = await em.findAndCount(CostCenter, filter as FilterQuery<CostCenter>, { orderBy, limit: pageSize, offset })
  const items = rows.map(toRow)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return NextResponse.json({ items, total, page, pageSize, totalPages })
}

export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const costCenterListItemSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  organizationId: z.uuid(),
  tenantId: z.uuid(),
})

export const openApi = createPostingRulesCrudOpenApi({
  resourceName: 'Cost centre',
  pluralName: 'Cost centres',
  querySchema: listQuerySchema,
  listResponseSchema: createPagedListResponseSchema(costCenterListItemSchema),
  create: {
    schema: costCenterCreateSchema,
    description: 'Creates a new cost centre (MPK).',
  },
  update: {
    schema: costCenterUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates an existing cost centre by id.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description:
      'Soft-deletes a cost centre by id. Blocked while a DefaultAccountPostingRule still uses it, or for the sentinel "UNALLOCATED" cost centre.',
  },
})
