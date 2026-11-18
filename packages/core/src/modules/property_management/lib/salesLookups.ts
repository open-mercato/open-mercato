import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { Scope } from './productUse'
import { normalizeDictionaryValue } from '@open-mercato/core/modules/dictionaries/lib/utils'
import { SalesOrder, SalesQuote } from '@open-mercato/core/modules/sales/data/entities'

const logger = createLogger('property_management')

export type SalesDocumentKind = 'order' | 'quote'

export const OPERATION_ID_METADATA_KEY = 'propertyManagementOperationId'
export const DOCUMENT_LOOKUP_PAGE_SIZE = 100
export const DOCUMENT_LOOKUP_MAX_CANDIDATES = 1000

const DOCUMENT_TABLES: Record<SalesDocumentKind, string> = {
  order: 'sales_orders',
  quote: 'sales_quotes',
}

const LOOKUP_WINDOW_MS = 24 * 60 * 60 * 1000

type IdRow = { id: string }

function selectRows<T>(em: EntityManager, sql: string, params: unknown[]): Promise<T[]> {
  return em.getConnection().execute<T[]>(sql, params, 'all', em.getTransactionContext())
}

export type SalesDocumentSummary = {
  id: string
  number: string | null
  status: string | null
  statusEntryId?: string | null
  deleted: boolean
}

export type OrderRecurrenceRow = {
  orderId: string
  status: string
  startsOn: string
  anchorDay: number | null
  periodCount: number | null
  endsOn: string | null
  nextPeriodIndex: number
  nextInvoiceOn: string | null
  scheduleVersion: number
  cancelEffectiveOn: string | null
  cancelSettlement: string | null
}

export type RecurringPeriodRow = {
  periodIndex: number
  periodStart: string
  periodEnd: string
  invoiceId: string | null
  creditMemoId: string | null
  billedFactor: string | null
  creditedFactor: string | null
}

function toIsoDate(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) {
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
  const text = String(value)
  return text.length >= 10 ? text.slice(0, 10) : null
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return String(value)
}

export type DocumentLookup = {
  operationId: string
  createdAt: Date
  channelId?: string | null
  customerEntityId?: string | null
}

function payloadUuid(payload: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = payload?.[key]
  return typeof value === 'string' && value.length ? value : null
}

export function documentLookupOf(op: { id: string; createdAt: Date; payload?: Record<string, unknown> | null }): DocumentLookup {
  return {
    operationId: op.id,
    createdAt: op.createdAt,
    channelId: payloadUuid(op.payload, 'channelId'),
    customerEntityId: payloadUuid(op.payload, 'customerEntityId'),
  }
}

type CandidateDocument = { id: string; createdAt: Date; metadata?: Record<string, unknown> | null }

type CandidateCursor = { createdAt: Date; id: string }

function candidateFilter(scope: Scope, lookup: DocumentLookup, cursor: CandidateCursor | null) {
  const since = new Date(lookup.createdAt.getTime() - LOOKUP_WINDOW_MS)
  return {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
    createdAt: { $gte: since },
    ...(lookup.channelId ? { channelId: lookup.channelId } : {}),
    ...(lookup.customerEntityId ? { customerEntityId: lookup.customerEntityId } : {}),
    ...(cursor
      ? { $or: [{ createdAt: { $gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { $gt: cursor.id } }] }
      : {}),
  }
}

const CANDIDATE_FIELDS = ['id', 'organizationId', 'tenantId', 'createdAt', 'metadata'] as const

async function loadCandidatePage(
  em: EntityManager,
  scope: Scope,
  kind: SalesDocumentKind,
  lookup: DocumentLookup,
  cursor: CandidateCursor | null,
): Promise<CandidateDocument[]> {
  const options = {
    fields: [...CANDIDATE_FIELDS],
    orderBy: { createdAt: 'asc', id: 'asc' } as const,
    limit: DOCUMENT_LOOKUP_PAGE_SIZE,
  }
  const where = candidateFilter(scope, lookup, cursor)
  const rows =
    kind === 'order'
      ? await findWithDecryption(em, SalesOrder, where as FilterQuery<SalesOrder>, options, scope)
      : await findWithDecryption(em, SalesQuote, where as FilterQuery<SalesQuote>, options, scope)
  return rows.map((row) => ({ id: row.id, createdAt: row.createdAt, metadata: row.metadata ?? null }))
}

function operationIdOf(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const value = (metadata as Record<string, unknown>)[OPERATION_ID_METADATA_KEY]
  return typeof value === 'string' ? value : null
}

function reportCandidateCap(kind: SalesDocumentKind, lookup: DocumentLookup): void {
  const attributes = { operationId: lookup.operationId, kind, maxCandidates: DOCUMENT_LOOKUP_MAX_CANDIDATES }
  logger.warn('The sales document lookup for an operation reached its candidate cap; later documents were not checked', attributes)
  getTelemetryRuntime()?.reportError(
    new Error(`[internal] Sales document lookup for operation ${lookup.operationId} reached ${DOCUMENT_LOOKUP_MAX_CANDIDATES} candidates`),
    { module: 'property_management', code: 'property_management.sales_document_lookup_capped', attributes },
  )
}

export async function findDocumentsByOperation(
  em: EntityManager,
  scope: Scope,
  kind: SalesDocumentKind,
  lookup: DocumentLookup,
): Promise<string[]> {
  const found: string[] = []
  let cursor: CandidateCursor | null = null
  let scanned = 0
  while (scanned < DOCUMENT_LOOKUP_MAX_CANDIDATES) {
    const page = await loadCandidatePage(em, scope, kind, lookup, cursor)
    scanned += page.length
    for (const document of page) {
      if (operationIdOf(document.metadata) === lookup.operationId) found.push(String(document.id))
    }
    if (page.length < DOCUMENT_LOOKUP_PAGE_SIZE) return found
    const last = page[page.length - 1]
    cursor = { createdAt: last.createdAt, id: last.id }
  }
  reportCandidateCap(kind, lookup)
  return found
}

export async function loadSalesDocument(
  em: EntityManager,
  scope: Scope,
  kind: SalesDocumentKind,
  id: string,
): Promise<SalesDocumentSummary | null> {
  const numberColumn = kind === 'order' ? 'order_number' : 'quote_number'
  const rows = await selectRows<Record<string, unknown>>(
    em,
    `select id, ${numberColumn} as number, status, status_entry_id, deleted_at from ${DOCUMENT_TABLES[kind]}
      where id = ? and organization_id = ? and tenant_id = ? limit 1`,
    [id, scope.organizationId, scope.tenantId],
  )
  const row = rows[0]
  if (!row) return null
  return {
    id: String(row.id),
    number: toStringOrNull(row.number),
    status: toStringOrNull(row.status),
    statusEntryId: toStringOrNull(row.status_entry_id),
    deleted: row.deleted_at !== null && row.deleted_at !== undefined,
  }
}

export async function loadSalesDocuments(
  em: EntityManager,
  scope: Scope,
  kind: SalesDocumentKind,
  ids: readonly string[],
): Promise<Map<string, SalesDocumentSummary>> {
  const unique = Array.from(new Set(ids.filter(Boolean)))
  const result = new Map<string, SalesDocumentSummary>()
  if (!unique.length) return result
  const numberColumn = kind === 'order' ? 'order_number' : 'quote_number'
  const placeholders = unique.map(() => '?').join(', ')
  const rows = await selectRows<Record<string, unknown>>(
    em,
    `select id, ${numberColumn} as number, status, status_entry_id, deleted_at from ${DOCUMENT_TABLES[kind]}
      where organization_id = ? and tenant_id = ? and id in (${placeholders})`,
    [scope.organizationId, scope.tenantId, ...unique],
  )
  for (const row of rows) {
    result.set(String(row.id), {
      id: String(row.id),
      number: toStringOrNull(row.number),
      status: toStringOrNull(row.status),
      statusEntryId: toStringOrNull(row.status_entry_id),
      deleted: row.deleted_at !== null && row.deleted_at !== undefined,
    })
  }
  return result
}

export async function findFirstOrderLineId(em: EntityManager, scope: Scope, orderId: string): Promise<string | null> {
  const rows = await selectRows<IdRow>(
    em,
    `select id from sales_order_lines
      where order_id = ? and organization_id = ? and tenant_id = ? and deleted_at is null
      order by line_number asc limit 1`,
    [orderId, scope.organizationId, scope.tenantId],
  )
  return rows[0] ? String(rows[0].id) : null
}

const ORDER_RECURRENCE_COLUMNS = `order_id, status, starts_on, anchor_day, period_count, ends_on, next_period_index, next_invoice_on,
            schedule_version, cancel_effective_on, cancel_settlement`

const RECURRING_PERIOD_COLUMNS = 'order_id, period_index, period_start, period_end, invoice_id, credit_memo_id, billed_factor, credited_factor'

function orderRecurrenceRowOf(row: Record<string, unknown>): OrderRecurrenceRow {
  return {
    orderId: String(row.order_id),
    status: String(row.status),
    startsOn: toIsoDate(row.starts_on) ?? '',
    anchorDay: toNumberOrNull(row.anchor_day),
    periodCount: toNumberOrNull(row.period_count),
    endsOn: toIsoDate(row.ends_on),
    nextPeriodIndex: toNumberOrNull(row.next_period_index) ?? 0,
    nextInvoiceOn: toIsoDate(row.next_invoice_on),
    scheduleVersion: toNumberOrNull(row.schedule_version) ?? 1,
    cancelEffectiveOn: toIsoDate(row.cancel_effective_on),
    cancelSettlement: toStringOrNull(row.cancel_settlement),
  }
}

function recurringPeriodRowOf(row: Record<string, unknown>): RecurringPeriodRow {
  return {
    periodIndex: toNumberOrNull(row.period_index) ?? 0,
    periodStart: toIsoDate(row.period_start) ?? '',
    periodEnd: toIsoDate(row.period_end) ?? '',
    invoiceId: toStringOrNull(row.invoice_id),
    creditMemoId: toStringOrNull(row.credit_memo_id),
    billedFactor: toStringOrNull(row.billed_factor),
    creditedFactor: toStringOrNull(row.credited_factor),
  }
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ')
}

function distinctIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids.filter((id) => id.length > 0)))
}

export async function readOrderRecurrenceRow(em: EntityManager, scope: Scope, orderId: string): Promise<OrderRecurrenceRow | null> {
  const rows = await selectRows<Record<string, unknown>>(
    em,
    `select ${ORDER_RECURRENCE_COLUMNS}
       from sales_order_recurrences
      where order_id = ? and organization_id = ? and tenant_id = ? and deleted_at is null limit 1`,
    [orderId, scope.organizationId, scope.tenantId],
  )
  const row = rows[0]
  return row ? orderRecurrenceRowOf(row) : null
}

export async function readOrderRecurrenceRows(
  em: EntityManager,
  scope: Scope,
  orderIds: readonly string[],
): Promise<Map<string, OrderRecurrenceRow>> {
  const ids = distinctIds(orderIds)
  if (!ids.length) return new Map()
  const rows = await selectRows<Record<string, unknown>>(
    em,
    `select ${ORDER_RECURRENCE_COLUMNS}
       from sales_order_recurrences
      where order_id in (${placeholders(ids.length)}) and organization_id = ? and tenant_id = ? and deleted_at is null`,
    [...ids, scope.organizationId, scope.tenantId],
  )
  const byOrder = new Map<string, OrderRecurrenceRow>()
  for (const row of rows) {
    const parsed = orderRecurrenceRowOf(row)
    if (!byOrder.has(parsed.orderId)) byOrder.set(parsed.orderId, parsed)
  }
  return byOrder
}

export async function readRecurringPeriodRows(em: EntityManager, scope: Scope, orderId: string): Promise<RecurringPeriodRow[]> {
  const rows = await selectRows<Record<string, unknown>>(
    em,
    `select ${RECURRING_PERIOD_COLUMNS}
       from sales_recurring_periods
      where order_id = ? and organization_id = ? and tenant_id = ?
      order by period_index asc`,
    [orderId, scope.organizationId, scope.tenantId],
  )
  return rows.map(recurringPeriodRowOf)
}

export async function readRecurringPeriodRowsByOrder(
  em: EntityManager,
  scope: Scope,
  orderIds: readonly string[],
): Promise<Map<string, RecurringPeriodRow[]>> {
  const ids = distinctIds(orderIds)
  if (!ids.length) return new Map()
  const rows = await selectRows<Record<string, unknown>>(
    em,
    `select ${RECURRING_PERIOD_COLUMNS}
       from sales_recurring_periods
      where order_id in (${placeholders(ids.length)}) and organization_id = ? and tenant_id = ?
      order by order_id asc, period_index asc`,
    [...ids, scope.organizationId, scope.tenantId],
  )
  const byOrder = new Map<string, RecurringPeriodRow[]>()
  for (const row of rows) {
    const orderId = String(row.order_id)
    const periods = byOrder.get(orderId) ?? []
    periods.push(recurringPeriodRowOf(row))
    byOrder.set(orderId, periods)
  }
  return byOrder
}

export async function resolveOrderStatusEntryId(em: EntityManager, scope: Scope, value: string): Promise<string | null> {
  const rows = await selectRows<IdRow>(
    em,
    `select entry.id from dictionary_entries entry
       join dictionaries dictionary on dictionary.id = entry.dictionary_id
      where dictionary.key = 'sales.order_status' and dictionary.organization_id = ? and dictionary.tenant_id = ?
        and dictionary.deleted_at is null and entry.organization_id = ? and entry.tenant_id = ? and entry.normalized_value = ?
      limit 1`,
    [scope.organizationId, scope.tenantId, scope.organizationId, scope.tenantId, normalizeDictionaryValue(value)],
  )
  return rows[0] ? String(rows[0].id) : null
}

export async function salesChannelExists(em: EntityManager, scope: Scope, channelId: string): Promise<boolean> {
  const rows = await selectRows<IdRow>(
    em,
    `select id from sales_channels where id = ? and organization_id = ? and tenant_id = ? and deleted_at is null limit 1`,
    [channelId, scope.organizationId, scope.tenantId],
  )
  return rows.length > 0
}

export async function orderStatusEntryExists(em: EntityManager, scope: Scope, entryId: string): Promise<boolean> {
  const rows = await selectRows<IdRow>(
    em,
    `select entry.id from dictionary_entries entry
       join dictionaries dictionary on dictionary.id = entry.dictionary_id
      where entry.id = ? and dictionary.key = 'sales.order_status'
        and dictionary.organization_id = ? and dictionary.tenant_id = ? and dictionary.deleted_at is null
        and entry.organization_id = ? and entry.tenant_id = ? limit 1`,
    [entryId, scope.organizationId, scope.tenantId, scope.organizationId, scope.tenantId],
  )
  return rows.length > 0
}

export async function loadDocumentNumbers(
  em: EntityManager,
  scope: Scope,
  kind: 'invoice' | 'credit_memo',
  ids: readonly string[],
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter(Boolean)))
  const result = new Map<string, string>()
  if (!unique.length) return result
  const table = kind === 'invoice' ? 'sales_invoices' : 'sales_credit_memos'
  const column = kind === 'invoice' ? 'invoice_number' : 'credit_memo_number'
  const placeholders = unique.map(() => '?').join(', ')
  const rows = await selectRows<Record<string, unknown>>(
    em,
    `select id, ${column} as number from ${table} where organization_id = ? and tenant_id = ? and id in (${placeholders})`,
    [scope.organizationId, scope.tenantId, ...unique],
  )
  for (const row of rows) result.set(String(row.id), String(row.number ?? ''))
  return result
}
