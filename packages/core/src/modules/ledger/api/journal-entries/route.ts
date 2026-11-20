import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { FilterQuery } from '@mikro-orm/core'
import { raw } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { FiscalPeriod, JournalEntry, JournalEntryLine, LedgerAccount } from '../../data/entities'
import { createLedgerCrudOpenApi, createPagedListResponseSchema } from '../openapi'
import { isIdsParamProvided, mergeIdFilter, parseIdsParam } from '@open-mercato/shared/lib/crud/ids'
import { readQueryParamList } from '@open-mercato/shared/lib/crud/query-params'

// `/api/ledger/journal-entries` — read-only list. No POST/PUT/DELETE:
// entries are only ever created through `postJournalEntry` /
// `reverseJournalEntry` (see commands/), never through this route.
//
// A request narrowed to one entry (`?id=`) also returns that entry's posted
// lines (account number, name, debit, credit) for the read-only detail page.
// The list itself stays headers only.
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
  postedBy: string | null
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

type JournalEntryLineRow = {
  id: string
  accountId: string
  accountNumber: string | null
  // An account has no name of its own; its `description` plays that role.
  accountName: string | null
  debit: string
  credit: string
}

type JournalEntryDetailRow = JournalEntryRow & { lines?: JournalEntryLineRow[] }

const toRow = (entry: JournalEntry): JournalEntryRow => ({
  id: String(entry.id),
  sequenceNumber: Number(entry.sequenceNumber),
  postedAt: entry.postedAt.toISOString(),
  operationDate: formatDateOnly(entry.operationDate),
  documentType: entry.documentType ?? null,
  documentNumber: entry.documentNumber ?? null,
  documentDate: entry.documentDate ? formatDateOnly(entry.documentDate) : null,
  postedBy: entry.postedBy ?? null,
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
  let filter: Record<string, unknown> = { tenantId: auth.tenantId }
  // Selected organization, not the user's home auth.orgId.
  if (organizationId) filter.organizationId = organizationId

  if (id) filter.id = id
  // `?ids=` — comma-separated or repeated — documented by the shared OpenAPI
  // factory (withIdsQueryParam) but previously ignored by every ledger GET.
  // Malformed/unknown ids match nothing, never the unfiltered list
  // (mergeIdFilter's own #4143 fail-closed behavior).
  const rawIds = readQueryParamList(url.searchParams, 'ids')
  if (isIdsParamProvided(rawIds)) {
    filter = mergeIdFilter(filter, parseIdsParam(rawIds), { idsParamProvided: true })
  }
  if (type) filter.type = type
  if (referenceType) filter.referenceType = referenceType
  if (referenceId) filter.referenceId = referenceId

  // `accountId` joins through `JournalEntryLine.accountId` — no ORM
  // relation exists between the two entities (plain FK-id columns, see
  // Design decisions). Previously loaded every matching line id into
  // memory and filtered `JournalEntry.id $in [...ids]`; a busy account
  // could exceed Postgres's 65,535 bind-parameter limit and 500 the whole
  // list. A correlated `EXISTS` subquery pushes the join into the database
  // instead, with a fixed, small number of bind parameters regardless of
  // how many lines the account has.
  if (accountId) {
    const params = organizationId ? [accountId, auth.tenantId, organizationId] : [accountId, auth.tenantId]
    const accountHasLine = raw(
      (alias) =>
        `exists (select 1 from journal_entry_lines jel where jel.journal_entry_id = ${alias}.id and jel.account_id = ? and jel.tenant_id = ?${organizationId ? ' and jel.organization_id = ?' : ''})`,
      params,
    )
    const andFilters = (filter.$and as unknown[] | undefined) ?? []
    andFilters.push({ [accountHasLine]: true })
    filter.$and = andFilters
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
  const [rows, total] = await em.findAndCount(JournalEntry, filter as FilterQuery<JournalEntry>, { orderBy, limit: pageSize, offset })
  const items: JournalEntryDetailRow[] = rows.map(toRow)
  if (id && rows.length === 1) {
    items[0].lines = await loadEntryLines(em, rows[0])
  }
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return NextResponse.json({ items, total, page, pageSize, totalPages })
}

// Lines of one entry, scoped to the entry's own organization/tenant, with the
// account number and name resolved in one extra query (no ORM relation
// between lines and accounts). Debit lines first, then credit lines.
async function loadEntryLines(em: EntityManager, entry: JournalEntry): Promise<JournalEntryLineRow[]> {
  const scope = { organizationId: entry.organizationId, tenantId: entry.tenantId }
  const lines = await findWithDecryption(
    em,
    JournalEntryLine,
    { journalEntryId: entry.id, ...scope },
    undefined,
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  const accountIds = [...new Set(lines.map((line) => line.accountId))]
  const accounts = accountIds.length
    ? await em.find(LedgerAccount, { id: { $in: accountIds }, ...scope }, { fields: ['id', 'number', 'description'] })
    : []
  const accountById = new Map(accounts.map((account) => [account.id, account]))
  const isDebit = (line: JournalEntryLine) => Number(line.debit) > 0
  return [...lines]
    .sort((a, b) => Number(isDebit(b)) - Number(isDebit(a)))
    .map((line) => {
      const account = accountById.get(line.accountId)
      return {
        id: String(line.id),
        accountId: String(line.accountId),
        accountNumber: account ? String(account.number) : null,
        accountName: account?.description ?? null,
        debit: String(line.debit),
        credit: String(line.credit),
      }
    })
}

const journalEntryListItemSchema = z.object({
  id: z.uuid(),
  sequenceNumber: z.number(),
  postedAt: z.string(),
  operationDate: z.string(),
  documentType: z.string().nullable(),
  documentNumber: z.string().nullable(),
  documentDate: z.string().nullable(),
  postedBy: z.string().nullable(),
  description: z.string(),
  type: z.enum(['NORMAL', 'OPENING', 'CLOSING', 'REVERSAL']),
  currencyId: z.uuid(),
  exchangeRate: z.string().nullable(),
  referenceType: z.string().nullable(),
  referenceId: z.uuid().nullable(),
  organizationId: z.uuid(),
  tenantId: z.uuid(),
})

const journalEntryLineSchema = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  accountNumber: z.string().nullable(),
  accountName: z.string().nullable(),
  debit: z.string(),
  credit: z.string(),
})

export const openApi = createLedgerCrudOpenApi({
  resourceName: 'Journal entry',
  pluralName: 'Journal entries',
  querySchema: listQuerySchema,
  listResponseSchema: createPagedListResponseSchema(
    journalEntryListItemSchema.extend({ lines: z.array(journalEntryLineSchema).optional() }),
  ),
})
