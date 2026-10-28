import type { EntityManager } from '@mikro-orm/postgresql'
import type { Scope } from './productUse'

export type SalesDocumentKind = 'order' | 'quote'

const DOCUMENT_TABLES: Record<SalesDocumentKind, string> = {
  order: 'sales_orders',
  quote: 'sales_quotes',
}

const LOOKUP_WINDOW_MS = 24 * 60 * 60 * 1000

type IdRow = { id: string }

export type SalesDocumentSummary = {
  id: string
  number: string | null
  status: string | null
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

export async function findDocumentsByOperation(
  em: EntityManager,
  scope: Scope,
  kind: SalesDocumentKind,
  operationId: string,
  operationCreatedAt: Date,
): Promise<string[]> {
  const since = new Date(operationCreatedAt.getTime() - LOOKUP_WINDOW_MS)
  const rows = await em.getConnection().execute<IdRow[]>(
    `select id from ${DOCUMENT_TABLES[kind]}
      where organization_id = ? and tenant_id = ? and created_at >= ?
        and metadata->>'propertyManagementOperationId' = ?
      order by created_at asc`,
    [scope.organizationId, scope.tenantId, since, operationId],
  )
  return rows.map((row) => String(row.id))
}

export async function loadSalesDocument(
  em: EntityManager,
  scope: Scope,
  kind: SalesDocumentKind,
  id: string,
): Promise<SalesDocumentSummary | null> {
  const numberColumn = kind === 'order' ? 'order_number' : 'quote_number'
  const rows = await em.getConnection().execute<Array<Record<string, unknown>>>(
    `select id, ${numberColumn} as number, status, deleted_at from ${DOCUMENT_TABLES[kind]}
      where id = ? and organization_id = ? and tenant_id = ? limit 1`,
    [id, scope.organizationId, scope.tenantId],
  )
  const row = rows[0]
  if (!row) return null
  return {
    id: String(row.id),
    number: toStringOrNull(row.number),
    status: toStringOrNull(row.status),
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
  const rows = await em.getConnection().execute<Array<Record<string, unknown>>>(
    `select id, ${numberColumn} as number, status, deleted_at from ${DOCUMENT_TABLES[kind]}
      where organization_id = ? and tenant_id = ? and id in (${placeholders})`,
    [scope.organizationId, scope.tenantId, ...unique],
  )
  for (const row of rows) {
    result.set(String(row.id), {
      id: String(row.id),
      number: toStringOrNull(row.number),
      status: toStringOrNull(row.status),
      deleted: row.deleted_at !== null && row.deleted_at !== undefined,
    })
  }
  return result
}

export async function findFirstOrderLineId(em: EntityManager, scope: Scope, orderId: string): Promise<string | null> {
  const rows = await em.getConnection().execute<IdRow[]>(
    `select id from sales_order_lines
      where order_id = ? and organization_id = ? and tenant_id = ?
      order by line_number asc limit 1`,
    [orderId, scope.organizationId, scope.tenantId],
  )
  return rows[0] ? String(rows[0].id) : null
}

export async function readOrderRecurrenceRow(em: EntityManager, scope: Scope, orderId: string): Promise<OrderRecurrenceRow | null> {
  const rows = await em.getConnection().execute<Array<Record<string, unknown>>>(
    `select order_id, status, starts_on, anchor_day, period_count, ends_on, next_period_index, next_invoice_on,
            schedule_version, cancel_effective_on, cancel_settlement
       from sales_order_recurrences
      where order_id = ? and organization_id = ? and tenant_id = ? limit 1`,
    [orderId, scope.organizationId, scope.tenantId],
  )
  const row = rows[0]
  if (!row) return null
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

export async function readRecurringPeriodRows(em: EntityManager, scope: Scope, orderId: string): Promise<RecurringPeriodRow[]> {
  const rows = await em.getConnection().execute<Array<Record<string, unknown>>>(
    `select period_index, period_start, period_end, invoice_id, credit_memo_id, billed_factor, credited_factor
       from sales_recurring_periods
      where order_id = ? and organization_id = ? and tenant_id = ?
      order by period_index asc`,
    [orderId, scope.organizationId, scope.tenantId],
  )
  return rows.map((row) => ({
    periodIndex: toNumberOrNull(row.period_index) ?? 0,
    periodStart: toIsoDate(row.period_start) ?? '',
    periodEnd: toIsoDate(row.period_end) ?? '',
    invoiceId: toStringOrNull(row.invoice_id),
    creditMemoId: toStringOrNull(row.credit_memo_id),
    billedFactor: toStringOrNull(row.billed_factor),
    creditedFactor: toStringOrNull(row.credited_factor),
  }))
}

export async function resolveOrderStatusEntryId(em: EntityManager, scope: Scope, value: string): Promise<string | null> {
  const rows = await em.getConnection().execute<IdRow[]>(
    `select entry.id from dictionary_entries entry
       join dictionaries dictionary on dictionary.id = entry.dictionary_id
      where dictionary.key = 'sales.order_status' and dictionary.organization_id = ? and dictionary.tenant_id = ?
        and dictionary.deleted_at is null and entry.organization_id = ? and entry.tenant_id = ? and entry.value = ?
      limit 1`,
    [scope.organizationId, scope.tenantId, scope.organizationId, scope.tenantId, value],
  )
  return rows[0] ? String(rows[0].id) : null
}

export async function salesChannelExists(em: EntityManager, scope: Scope, channelId: string): Promise<boolean> {
  const rows = await em.getConnection().execute<IdRow[]>(
    `select id from sales_channels where id = ? and organization_id = ? and tenant_id = ? and deleted_at is null limit 1`,
    [channelId, scope.organizationId, scope.tenantId],
  )
  return rows.length > 0
}

export async function orderStatusEntryExists(em: EntityManager, scope: Scope, entryId: string): Promise<boolean> {
  const rows = await em.getConnection().execute<IdRow[]>(
    `select entry.id from dictionary_entries entry
       join dictionaries dictionary on dictionary.id = entry.dictionary_id
      where entry.id = ? and dictionary.key = 'sales.order_status'
        and entry.organization_id = ? and entry.tenant_id = ? limit 1`,
    [entryId, scope.organizationId, scope.tenantId],
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
  const rows = await em.getConnection().execute<Array<Record<string, unknown>>>(
    `select id, ${column} as number from ${table} where organization_id = ? and tenant_id = ? and id in (${placeholders})`,
    [scope.organizationId, scope.tenantId, ...unique],
  )
  for (const row of rows) result.set(String(row.id), String(row.number ?? ''))
  return result
}
