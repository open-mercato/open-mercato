import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { FilterQuery } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { isIdsParamProvided, mergeIdFilter, parseIdsParam } from '@open-mercato/shared/lib/crud/ids'
import { readQueryParamList } from '@open-mercato/shared/lib/crud/query-params'
import { DefaultAccountPostingRule } from '../../data/entities'
import { defaultAccountPostingRuleCreateSchema, defaultAccountPostingRuleUpdateSchema } from '../../data/validators'
import { createPostingRulesCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../openapi'

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
    entity: DefaultAccountPostingRule,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    // No `deletedAt` on this entity (see Design Decisions, "4→5 rules") —
    // `deleteDefaultAccountPostingRule` hard-deletes; omitted here so the
    // shared CRUD factory's own soft-delete assumptions never apply to
    // this route's underlying entity metadata.
  },
  events: {
    module: 'posting_rules',
    entity: 'default_account_posting_rule',
    persistent: true,
  },
  actions: {
    create: {
      commandId: 'posting_rules.createDefaultAccountPostingRule',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { defaultAccountPostingRuleId: string }).defaultAccountPostingRuleId) }),
      status: 201,
    },
    update: {
      commandId: 'posting_rules.updateDefaultAccountPostingRule',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'posting_rules.deleteDefaultAccountPostingRule',
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
  sortField: z.enum(['createdAt', 'updatedAt']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  sourceAccountId: z.uuid().optional(),
}).loose()

type DefaultAccountPostingRuleRow = {
  id: string
  sourceAccountId: string
  targetAccountId: string
  defaultCostCenterId: string | null
  createdAt: string | null
  updatedAt: string | null
  organizationId: string
  tenantId: string
}

const toRow = (rule: DefaultAccountPostingRule): DefaultAccountPostingRuleRow => ({
  id: String(rule.id),
  sourceAccountId: String(rule.sourceAccountId),
  targetAccountId: String(rule.targetAccountId),
  defaultCostCenterId: rule.defaultCostCenterId ?? null,
  createdAt: rule.createdAt ? rule.createdAt.toISOString() : null,
  updatedAt: rule.updatedAt ? rule.updatedAt.toISOString() : null,
  organizationId: String(rule.organizationId),
  tenantId: String(rule.tenantId),
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
    sortField: url.searchParams.get('sortField') ?? undefined,
    sortDir: url.searchParams.get('sortDir') ?? undefined,
    sourceAccountId: url.searchParams.get('sourceAccountId') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 1 }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null

  const { id, page, pageSize, sortField, sortDir, sourceAccountId } = parsed.data
  let filter: Record<string, unknown> = { tenantId: auth.tenantId }
  if (organizationId) filter.organizationId = organizationId
  if (id) filter.id = id
  const rawIds = readQueryParamList(url.searchParams, 'ids')
  if (isIdsParamProvided(rawIds)) {
    filter = mergeIdFilter(filter, parseIdsParam(rawIds), { idsParamProvided: true })
  }
  if (sourceAccountId) filter.sourceAccountId = sourceAccountId

  const orderBy: Record<string, 'ASC' | 'DESC'> = {}
  if (sortField) {
    orderBy[sortField] = sortDir === 'desc' ? 'DESC' : 'ASC'
  } else {
    orderBy.createdAt = 'DESC'
  }

  const offset = (page - 1) * pageSize
  const [rows, total] = await em.findAndCount(DefaultAccountPostingRule, filter as FilterQuery<DefaultAccountPostingRule>, { orderBy, limit: pageSize, offset })
  const items = rows.map(toRow)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return NextResponse.json({ items, total, page, pageSize, totalPages })
}

export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const ruleListItemSchema = z.object({
  id: z.uuid(),
  sourceAccountId: z.uuid(),
  targetAccountId: z.uuid(),
  defaultCostCenterId: z.uuid().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  organizationId: z.uuid(),
  tenantId: z.uuid(),
})

export const openApi = createPostingRulesCrudOpenApi({
  resourceName: 'Default account posting rule',
  pluralName: 'Default account posting rules',
  querySchema: listQuerySchema,
  listResponseSchema: createPagedListResponseSchema(ruleListItemSchema),
  create: {
    schema: defaultAccountPostingRuleCreateSchema,
    description: 'Creates a new zespół 4 → zespół 5 default account mapping, with an optional default cost centre.',
  },
  update: {
    schema: defaultAccountPostingRuleUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates an existing default account posting rule by id. `sourceAccountId` cannot be changed after creation.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a default account posting rule by id.',
  },
})
