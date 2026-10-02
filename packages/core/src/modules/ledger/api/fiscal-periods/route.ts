import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { FilterQuery } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { FiscalPeriod } from '../../data/entities'
import { createFiscalPeriodSchema } from '../../data/validators'
import { createLedgerCrudOpenApi, createPagedListResponseSchema } from '../openapi'
import { isIdsParamProvided, mergeIdFilter, parseIdsParam } from '@open-mercato/shared/lib/crud/ids'
import { readQueryParamList } from '@open-mercato/shared/lib/crud/query-params'

// `/api/ledger/fiscal-periods` — list + create only. Locking and
// unlocking a period is not a field-level edit and is deliberately NOT
// wired here: see `[id]/lock/route.ts` and `[id]/unlock/route.ts`, custom
// write routes through the mutation guard registry per `AGENTS.md` → API
// Routes. No delete route exists for `FiscalPeriod` in Phase 1 (see spec's
// Data Models → FiscalPeriod).
const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['ledger.periods.view'] },
  POST: { requireAuth: true, requireFeatures: ['ledger.periods.manage'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).loose()
type CrudInput = Record<string, unknown>

const crud = makeCrudRoute<CrudInput, CrudInput, Record<string, unknown>>({
  metadata: routeMetadata,
  orm: {
    entity: FiscalPeriod,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  events: {
    module: 'ledger',
    entity: 'fiscal_period',
    persistent: true,
  },
  actions: {
    create: {
      commandId: 'ledger.createFiscalPeriod',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { fiscalPeriodId: string }).fiscalPeriodId) }),
      status: 201,
    },
  },
})

const listQuerySchema = z.object({
  id: z.uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  isLocked: z.enum(['true', 'false']).optional(),
  sortField: z.enum(['startDate', 'endDate', 'createdAt', 'updatedAt']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).loose()

type FiscalPeriodRow = {
  id: string
  startDate: string
  endDate: string
  isLocked: boolean
  createdAt: string | null
  updatedAt: string | null
  organizationId: string
  tenantId: string
}

// `type: 'date'` MikroORM properties can come back as a plain string
// rather than a `Date` instance (same caveat the `staff` module's
// timesheet report routes already guard against) — format defensively.
const formatDateOnly = (value: Date | string): string =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)

const toRow = (period: FiscalPeriod): FiscalPeriodRow => ({
  id: String(period.id),
  startDate: formatDateOnly(period.startDate),
  endDate: formatDateOnly(period.endDate),
  isLocked: !!period.isLocked,
  createdAt: period.createdAt ? period.createdAt.toISOString() : null,
  updatedAt: period.updatedAt ? period.updatedAt.toISOString() : null,
  organizationId: String(period.organizationId),
  tenantId: String(period.tenantId),
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
    isLocked: url.searchParams.get('isLocked') ?? undefined,
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

  const { id, page, pageSize, isLocked, sortField, sortDir } = parsed.data
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
  if (isLocked === 'true') filter.isLocked = true
  if (isLocked === 'false') filter.isLocked = false

  const fieldMap: Record<string, string> = {
    startDate: 'startDate',
    endDate: 'endDate',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  }
  const orderBy: Record<string, 'ASC' | 'DESC'> = {}
  if (sortField) {
    const mapped = fieldMap[sortField] || 'startDate'
    orderBy[mapped] = sortDir === 'desc' ? 'DESC' : 'ASC'
  } else {
    orderBy.startDate = 'DESC'
  }

  const offset = (page - 1) * pageSize
  const [rows, total] = await em.findAndCount(FiscalPeriod, filter as FilterQuery<FiscalPeriod>, { orderBy, limit: pageSize, offset })
  const items = rows.map(toRow)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return NextResponse.json({ items, total, page, pageSize, totalPages })
}

export const POST = crud.POST

const fiscalPeriodListItemSchema = z.object({
  id: z.uuid(),
  startDate: z.string(),
  endDate: z.string(),
  isLocked: z.boolean(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  organizationId: z.uuid(),
  tenantId: z.uuid(),
})

export const openApi = createLedgerCrudOpenApi({
  resourceName: 'Fiscal period',
  pluralName: 'Fiscal periods',
  querySchema: listQuerySchema,
  listResponseSchema: createPagedListResponseSchema(fiscalPeriodListItemSchema),
  create: {
    schema: createFiscalPeriodSchema,
    description:
      'Creates a new fiscal period, unlocked by default. The date range must not overlap an existing period for this organization.',
  },
})
