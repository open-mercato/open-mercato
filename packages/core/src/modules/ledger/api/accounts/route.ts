import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { FilterQuery } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { LedgerAccount } from '../../data/entities'
import { ledgerAccountCreateSchema, ledgerAccountUpdateSchema } from '../../data/validators'
import { createLedgerCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../openapi'

// `/api/ledger/accounts` — chart-of-accounts CRUD (OM-11). Hand-written GET
// mirrors currencies/api/currencies/route.ts's reference pattern rather than
// the query-engine-driven `list` config, since `E.ledger.*` entity ids don't
// exist yet in this worktree (populated by `yarn generate`, deferred to
// OM-15) and this module's own commands already accept that dependency for
// the indexer only — the list endpoint doesn't need to.
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
    entity: LedgerAccount,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  events: {
    module: 'ledger',
    entity: 'ledger_account',
    persistent: true,
  },
  actions: {
    create: {
      commandId: 'ledger.createLedgerAccount',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { ledgerAccountId: string }).ledgerAccountId) }),
      status: 201,
    },
    update: {
      commandId: 'ledger.updateLedgerAccount',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'ledger.deleteLedgerAccount',
      schema: rawBodySchema,
      mapInput: ({ raw, ctx }) => ({
        id: ((raw as Record<string, unknown>).query as Record<string, unknown> | undefined)?.id as string | undefined,
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
  sortField: z.enum(['slug', 'createdAt', 'updatedAt']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  accountTypeId: z.uuid().optional(),
  parentAccountId: z.uuid().optional(),
}).loose()

type LedgerAccountRow = {
  id: string
  slug: string
  accountTypeId: string
  parentAccountId: string | null
  description: string | null
  createdAt: string | null
  updatedAt: string | null
  organizationId: string
  tenantId: string
}

const toRow = (account: LedgerAccount): LedgerAccountRow => ({
  id: String(account.id),
  slug: String(account.slug),
  accountTypeId: String(account.accountTypeId),
  parentAccountId: account.parentAccountId ?? null,
  description: account.description ?? null,
  createdAt: account.createdAt ? account.createdAt.toISOString() : null,
  updatedAt: account.updatedAt ? account.updatedAt.toISOString() : null,
  organizationId: String(account.organizationId),
  tenantId: String(account.tenantId),
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
    accountTypeId: url.searchParams.get('accountTypeId') ?? undefined,
    parentAccountId: url.searchParams.get('parentAccountId') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 1 }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null

  const { id, page, pageSize, search, sortField, sortDir, accountTypeId, parentAccountId } = parsed.data
  const filter: FilterQuery<LedgerAccount> = {
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
  if (accountTypeId) filter.accountTypeId = accountTypeId
  if (parentAccountId) filter.parentAccountId = parentAccountId
  if (search) {
    filter.$or = [
      { slug: { $ilike: `%${escapeLikePattern(search)}%` } },
      { description: { $ilike: `%${escapeLikePattern(search)}%` } },
    ]
  }

  const fieldMap: Record<string, string> = {
    slug: 'slug',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  }
  const orderBy: Record<string, 'ASC' | 'DESC'> = {}
  if (sortField) {
    const mapped = fieldMap[sortField] || 'slug'
    orderBy[mapped] = sortDir === 'desc' ? 'DESC' : 'ASC'
  } else {
    orderBy.slug = 'ASC'
  }

  const offset = (page - 1) * pageSize
  const [rows, total] = await em.findAndCount(LedgerAccount, filter, { orderBy, limit: pageSize, offset })
  const items = rows.map(toRow)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return NextResponse.json({ items, total, page, pageSize, totalPages })
}

export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const ledgerAccountListItemSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  accountTypeId: z.uuid(),
  parentAccountId: z.uuid().nullable(),
  description: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  organizationId: z.uuid(),
  tenantId: z.uuid(),
})

export const openApi = createLedgerCrudOpenApi({
  resourceName: 'Ledger account',
  pluralName: 'Ledger accounts',
  querySchema: listQuerySchema,
  listResponseSchema: createPagedListResponseSchema(ledgerAccountListItemSchema),
  create: {
    schema: ledgerAccountCreateSchema,
    description: 'Creates a new chart-of-accounts account.',
  },
  update: {
    schema: ledgerAccountUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description:
      'Updates an existing account by id. `accountTypeId` cannot be changed once the account has posted journal entries.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes an account by id. Blocked while it has posted journal entries.',
  },
})
