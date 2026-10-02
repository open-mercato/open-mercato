import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { FilterQuery } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { LedgerAccountGroup } from '../../data/entities'
import { createLedgerCrudOpenApi, createPagedListResponseSchema } from '../openapi'
import { isIdsParamProvided, mergeIdFilter, parseIdsParam } from '@open-mercato/shared/lib/crud/ids'
import { readQueryParamList } from '@open-mercato/shared/lib/crud/query-params'

// `/api/ledger/account-groups` — read-only list (PR #6340 review nit).
// No POST/PUT/DELETE: `LedgerAccountGroup` rows are permanently
// system-seeded reference data (`seedPolishAccountGroups`, called from
// `setup.ts`'s `seedDefaults` — same convention as the `currencies`
// module's own seeded rows), never created or edited by tenants through
// any command. This endpoint exists only so the account-type form can
// resolve a real dropdown/label for `accountGroupId` instead of the
// free-text input it previously used.
const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['ledger.accounts.view'] },
}

export const metadata = routeMetadata

const listQuerySchema = z.object({
  id: z.uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
  jurisdiction: z.string().optional(),
  sortField: z.enum(['code', 'name', 'jurisdiction', 'createdAt']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).loose()

type LedgerAccountGroupRow = {
  id: string
  jurisdiction: string
  code: string
  name: string
  createdAt: string
  organizationId: string
  tenantId: string
}

const toRow = (accountGroup: LedgerAccountGroup): LedgerAccountGroupRow => ({
  id: String(accountGroup.id),
  jurisdiction: String(accountGroup.jurisdiction),
  code: String(accountGroup.code),
  name: String(accountGroup.name),
  createdAt: accountGroup.createdAt.toISOString(),
  organizationId: String(accountGroup.organizationId),
  tenantId: String(accountGroup.tenantId),
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
    jurisdiction: url.searchParams.get('jurisdiction') ?? undefined,
    sortField: url.searchParams.get('sortField') ?? undefined,
    sortDir: url.searchParams.get('sortDir') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 1 }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null

  const { id, page, pageSize, search, jurisdiction, sortField, sortDir } = parsed.data
  let filter: Record<string, unknown> = { tenantId: auth.tenantId }
  // Selected organization, not the user's home auth.orgId (PR #6340 review, M6).
  if (organizationId) filter.organizationId = organizationId

  if (id) filter.id = id
  // `?ids=` — comma-separated or repeated — same fail-closed pattern as the
  // other ledger list routes (mergeIdFilter's #4143 semantics).
  const rawIds = readQueryParamList(url.searchParams, 'ids')
  if (isIdsParamProvided(rawIds)) {
    filter = mergeIdFilter(filter, parseIdsParam(rawIds), { idsParamProvided: true })
  }
  if (jurisdiction) filter.jurisdiction = jurisdiction
  if (search) {
    filter.$or = [
      { code: { $ilike: `%${escapeLikePattern(search)}%` } },
      { name: { $ilike: `%${escapeLikePattern(search)}%` } },
    ]
  }

  const fieldMap: Record<string, string> = {
    code: 'code',
    name: 'name',
    jurisdiction: 'jurisdiction',
    createdAt: 'createdAt',
  }
  const orderBy: Record<string, 'ASC' | 'DESC'> = {}
  if (sortField) {
    const mapped = fieldMap[sortField] || 'code'
    orderBy[mapped] = sortDir === 'desc' ? 'DESC' : 'ASC'
  } else {
    orderBy.code = 'ASC'
  }

  const offset = (page - 1) * pageSize
  const [rows, total] = await em.findAndCount(LedgerAccountGroup, filter as FilterQuery<LedgerAccountGroup>, { orderBy, limit: pageSize, offset })
  const items = rows.map(toRow)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return NextResponse.json({ items, total, page, pageSize, totalPages })
}

const ledgerAccountGroupListItemSchema = z.object({
  id: z.uuid(),
  jurisdiction: z.string(),
  code: z.string(),
  name: z.string(),
  createdAt: z.string(),
  organizationId: z.uuid(),
  tenantId: z.uuid(),
})

export const openApi = createLedgerCrudOpenApi({
  resourceName: 'Ledger account group',
  pluralName: 'Ledger account groups',
  querySchema: listQuerySchema,
  listResponseSchema: createPagedListResponseSchema(ledgerAccountGroupListItemSchema),
})
