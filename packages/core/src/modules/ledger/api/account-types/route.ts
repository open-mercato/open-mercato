import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { FilterQuery } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { LedgerAccountType } from '../../data/entities'
import { ledgerAccountTypeCreateSchema, ledgerAccountTypeUpdateSchema } from '../../data/validators'
import { createLedgerCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../openapi'
import { isIdsParamProvided, mergeIdFilter, parseIdsParam } from '@open-mercato/shared/lib/crud/ids'
import { readQueryParamList } from '@open-mercato/shared/lib/crud/query-params'

// `/api/ledger/account-types` — chart-of-accounts type CRUD. Same
// hand-written-GET pattern as `api/accounts/route.ts` — see that file's
// header comment for why this doesn't use the query-engine `list` config.
const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['ledger.accounts.view'] },
  POST: { requireAuth: true, requireFeatures: ['ledger.accounts.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['ledger.accounts.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['ledger.accounts.manage'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).loose()
type CrudInput = Record<string, unknown>

const crud = makeCrudRoute<CrudInput, CrudInput, Record<string, unknown>>({
  metadata: routeMetadata,
  orm: {
    entity: LedgerAccountType,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  events: {
    module: 'ledger',
    entity: 'ledger_account_type',
    persistent: true,
  },
  actions: {
    create: {
      commandId: 'ledger.createLedgerAccountType',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { ledgerAccountTypeId: string }).ledgerAccountTypeId) }),
      status: 201,
    },
    update: {
      commandId: 'ledger.updateLedgerAccountType',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'ledger.deleteLedgerAccountType',
      schema: rawBodySchema,
      mapInput: ({ raw, ctx }) => ({
        // `id` may arrive as `?id=` (the UI's own delete call) or in the JSON
        // body (the documented OpenAPI contract — `del.schema` describes a
        // `{ id }` body; PR #6340 review nit). Query wins when both are sent,
        // matching this route's pre-existing behavior.
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
  sortField: z.enum(['slug', 'name', 'createdAt', 'updatedAt']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  normalBalance: z.enum(['DEBIT', 'CREDIT']).optional(),
  parentAccountTypeId: z.uuid().optional(),
  accountGroupId: z.uuid().optional(),
}).loose()

type LedgerAccountTypeRow = {
  id: string
  slug: string
  name: string
  normalBalance: string
  parentAccountTypeId: string | null
  accountGroupId: string | null
  createdAt: string | null
  updatedAt: string | null
  organizationId: string
  tenantId: string
}

const toRow = (accountType: LedgerAccountType): LedgerAccountTypeRow => ({
  id: String(accountType.id),
  slug: String(accountType.slug),
  name: String(accountType.name),
  normalBalance: String(accountType.normalBalance),
  parentAccountTypeId: accountType.parentAccountTypeId ?? null,
  accountGroupId: accountType.accountGroupId ?? null,
  createdAt: accountType.createdAt ? accountType.createdAt.toISOString() : null,
  updatedAt: accountType.updatedAt ? accountType.updatedAt.toISOString() : null,
  organizationId: String(accountType.organizationId),
  tenantId: String(accountType.tenantId),
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
    normalBalance: url.searchParams.get('normalBalance') ?? undefined,
    parentAccountTypeId: url.searchParams.get('parentAccountTypeId') ?? undefined,
    accountGroupId: url.searchParams.get('accountGroupId') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 1 }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null

  const { id, page, pageSize, search, sortField, sortDir, normalBalance, parentAccountTypeId, accountGroupId } =
    parsed.data
  let filter: Record<string, unknown> = {
    tenantId: auth.tenantId,
    deletedAt: null,
  }
  // Selected organization (resolveOrganizationScopeForRequest), not the user's
  // home auth.orgId — a user who switched organizations must see that
  // organization's rows, not their home org's (PR #6340 review, M6). Superadmin
  // with no explicit selection still lists across every organization.
  if (organizationId) {
    filter.organizationId = organizationId
  }

  if (id) filter.id = id
  // `?ids=` — comma-separated or repeated — documented by the shared OpenAPI
  // factory (withIdsQueryParam) but previously ignored by every ledger GET
  // (PR #6340 review nit). Malformed/unknown ids match nothing, never the
  // unfiltered list (mergeIdFilter's own #4143 fail-closed behavior).
  const rawIds = readQueryParamList(url.searchParams, 'ids')
  if (isIdsParamProvided(rawIds)) {
    filter = mergeIdFilter(filter, parseIdsParam(rawIds), { idsParamProvided: true })
  }
  if (normalBalance) filter.normalBalance = normalBalance
  if (parentAccountTypeId) filter.parentAccountTypeId = parentAccountTypeId
  if (accountGroupId) filter.accountGroupId = accountGroupId
  if (search) {
    filter.$or = [
      { slug: { $ilike: `%${escapeLikePattern(search)}%` } },
      { name: { $ilike: `%${escapeLikePattern(search)}%` } },
    ]
  }

  const fieldMap: Record<string, string> = {
    slug: 'slug',
    name: 'name',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  }
  const orderBy: Record<string, 'ASC' | 'DESC'> = {}
  if (sortField) {
    const mapped = fieldMap[sortField] || 'name'
    orderBy[mapped] = sortDir === 'desc' ? 'DESC' : 'ASC'
  } else {
    orderBy.name = 'ASC'
  }

  const offset = (page - 1) * pageSize
  const [rows, total] = await em.findAndCount(LedgerAccountType, filter as FilterQuery<LedgerAccountType>, { orderBy, limit: pageSize, offset })
  const items = rows.map(toRow)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return NextResponse.json({ items, total, page, pageSize, totalPages })
}

export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const ledgerAccountTypeListItemSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  normalBalance: z.enum(['DEBIT', 'CREDIT']),
  parentAccountTypeId: z.uuid().nullable(),
  accountGroupId: z.uuid().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  organizationId: z.uuid(),
  tenantId: z.uuid(),
})

export const openApi = createLedgerCrudOpenApi({
  resourceName: 'Ledger account type',
  pluralName: 'Ledger account types',
  querySchema: listQuerySchema,
  listResponseSchema: createPagedListResponseSchema(ledgerAccountTypeListItemSchema),
  create: {
    schema: ledgerAccountTypeCreateSchema,
    description: 'Creates a new chart-of-accounts type.',
  },
  update: {
    schema: ledgerAccountTypeUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description:
      'Updates an existing account type by id. `normalBalance` and `accountGroupId` cannot be changed once an account of this type has posted entries.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description:
      'Soft-deletes an account type by id. Blocked while an account of this type has posted entries, or another type still names it as parent.',
  },
})
