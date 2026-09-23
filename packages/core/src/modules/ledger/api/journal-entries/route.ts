import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { FilterQuery } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { FiscalPeriod, JournalEntry, JournalEntryLine } from '../../data/entities'
import { createLedgerCrudOpenApi, createPagedListResponseSchema } from '../openapi'

// `/api/ledger/journal-entries` — read-only list (OM-11). No POST/PUT/DELETE:
// entries are only ever created through `postJournalEntry` /
// `reverseJournalEntry` (see commands/), never through this route.
//
// `accountId` and `periodId` are not stored columns on `JournalEntry`
// itself (see data/entities.ts) — `accountId` lives on `JournalEntryLine`,
// and `periodId` is resolved server-side to the named `FiscalPeriod`'s
// date range and applied as an `operationDate` filter, per the spec's
// Queries/API section.
const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['ledger.entries.view'] },
}

export const metadata = routeMetadata

const listQuerySchema = z.object({
  id: z.uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  accountId: z.uuid().optional(),
  periodId: z.uuid().optional(),
  type: z.enum(['NORMAL', 'OPENING', 'CLOSING', 'REVERSAL']).optional(),
  referenceType: z.string().optional(),
  referenceId: z.uuid().optional(),
  sortField: z.enum(['operationDate', 'postedAt', 'sequenceNumber']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).loose()

type JournalEntryRow = {
  id: string
  sequenceNumber: number
  postedAt: string
  operationDate: string
  documentType: string | null
  documentNumber: string | null
  documentDate: string | null
  description: string
  type: string
  currencyId: string
  exchangeRate: string | null
  referenceType: string | null
  referenceId: string | null
  organizationId: string
  tenantId: string
}

// `type: 'date'` MikroORM properties can come back as a plain string
// rather than a `Date` instance (same caveat the `staff` module's
// timesheet report routes already guard against) — format defensively.
const formatDateOnly = (value: Date | string): string =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)

const toRow = (entry: JournalEntry): JournalEntryRow => ({
  id: String(entry.id),
  sequenceNumber: Number(entry.sequenceNumber),
  postedAt: entry.postedAt.toISOString(),
  operationDate: formatDateOnly(entry.operationDate),
  documentType: entry.documentType ?? null,
  documentNumber: entry.documentNumber ?? null,
  documentDate: entry.documentDate ? formatDateOnly(entry.documentDate) : null,
  description: String(entry.description),
  type: String(entry.type),
  currencyId: String(entry.currencyId),
  exchangeRate: entry.exchangeRate ?? null,
  referenceType: entry.referenceType ?? null,
  referenceId: entry.referenceId ?? null,
  organizationId: String(entry.organizationId),
  tenantId: String(entry.tenantId),
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
    accountId: url.searchParams.get('accountId') ?? undefined,
    periodId: url.searchParams.get('periodId') ?? undefined,
    type: url.searchParams.get('type') ?? undefined,
    referenceType: url.searchParams.get('referenceType') ?? undefined,
    referenceId: url.searchParams.get('referenceId') ?? undefined,
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

  const { id, page, pageSize, accountId, periodId, type, referenceType, referenceId, sortField, sortDir } = parsed.data
  const filter: FilterQuery<JournalEntry> = { tenantId: auth.tenantId }
  // Selected organization, not the user's home auth.orgId (PR #6340 review, M6).
  if (organizationId) filter.organizationId = organizationId

  if (id) filter.id = id
  if (type) filter.type = type
  if (referenceType) filter.referenceType = referenceType
  if (referenceId) filter.referenceId = referenceId

  // `accountId` joins through `JournalEntryLine.accountId` — no ORM
  // relation exists between the two entities (plain FK-id columns, see
  // Design decisions), so this is a two-step lookup rather than a join.
  if (accountId) {
    const lineFilter: FilterQuery<JournalEntryLine> = { accountId, tenantId: auth.tenantId }
    if (organizationId) lineFilter.organizationId = organizationId
    const lines = await em.find(JournalEntryLine, lineFilter, { fields: ['journalEntryId'] })
    const journalEntryIds = [...new Set(lines.map((line) => line.journalEntryId))]
    if (journalEntryIds.length === 0) {
      return NextResponse.json({ items: [], total: 0, page, pageSize, totalPages: 1 })
    }
    filter.id = { $in: journalEntryIds }
  }

  // `periodId` resolves to the named `FiscalPeriod`'s date range, applied
  // as an `operationDate` filter — `FiscalPeriod` is not a stored FK on
  // `JournalEntry` (app-layer resolution only, see spec's Queries/API).
  if (periodId) {
    const periodFilter: FilterQuery<FiscalPeriod> = { id: periodId, tenantId: auth.tenantId, deletedAt: null }
    if (organizationId) periodFilter.organizationId = organizationId
    const period = await em.findOne(FiscalPeriod, periodFilter)
    if (!period) {
      return NextResponse.json({ items: [], total: 0, page, pageSize, totalPages: 1 })
    }
    filter.operationDate = { $gte: period.startDate, $lte: period.endDate }
  }

  const fieldMap: Record<string, string> = {
    operationDate: 'operationDate',
    postedAt: 'postedAt',
    sequenceNumber: 'sequenceNumber',
  }
  const orderBy: Record<string, 'ASC' | 'DESC'> = {}
  if (sortField) {
    const mapped = fieldMap[sortField] || 'sequenceNumber'
    orderBy[mapped] = sortDir === 'asc' ? 'ASC' : 'DESC'
  } else {
    orderBy.sequenceNumber = 'DESC'
  }

  const offset = (page - 1) * pageSize
  const [rows, total] = await em.findAndCount(JournalEntry, filter, { orderBy, limit: pageSize, offset })
  const items = rows.map(toRow)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return NextResponse.json({ items, total, page, pageSize, totalPages })
}

const journalEntryListItemSchema = z.object({
  id: z.uuid(),
  sequenceNumber: z.number(),
  postedAt: z.string(),
  operationDate: z.string(),
  documentType: z.string().nullable(),
  documentNumber: z.string().nullable(),
  documentDate: z.string().nullable(),
  description: z.string(),
  type: z.enum(['NORMAL', 'OPENING', 'CLOSING', 'REVERSAL']),
  currencyId: z.uuid(),
  exchangeRate: z.string().nullable(),
  referenceType: z.string().nullable(),
  referenceId: z.uuid().nullable(),
  organizationId: z.uuid(),
  tenantId: z.uuid(),
})

export const openApi = createLedgerCrudOpenApi({
  resourceName: 'Journal entry',
  pluralName: 'Journal entries',
  querySchema: listQuerySchema,
  listResponseSchema: createPagedListResponseSchema(journalEntryListItemSchema),
})
