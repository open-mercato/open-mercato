import type { EntityManager } from '@mikro-orm/postgresql'
import { roundDecimalHalfUp, subtractDecimalStrings, sumDecimalStrings } from './money'

/**
 * The receivables read model.
 *
 * Aging is built from sales invoices, not from the ledger: the GL knows the AR
 * account balance but not which invoice a receipt settled, and an aging bucket
 * needs the invoice's own due date. The ledger balance travels beside the aging
 * total as a reconciliation figure, so a posting that bypassed the sales flow is
 * visible as a delta instead of silently changing the buckets.
 *
 * Scope is explicit on every query. Amounts cross this module as decimal strings
 * and are summed with the ledger's own helpers, never with `+`.
 */

export type ArScope = { tenantId: string; organizationId: string }

export type AgingBucket = 'current' | 'days1to30' | 'days31to60' | 'days61to90' | 'days90plus'

export const AGING_BUCKETS: readonly AgingBucket[] = [
  'current',
  'days1to30',
  'days31to60',
  'days61to90',
  'days90plus',
]

export type ArInvoiceRow = {
  id: string
  invoiceNumber: string
  customerEntityId: string | null
  customerName: string | null
  issueDate: string | null
  dueDate: string | null
  currencyCode: string
  grossAmount: string
  outstandingAmount: string
  bucket: AgingBucket
}

export type ArAging = {
  asOf: string
  currencyCode: string | null
  buckets: Record<AgingBucket, { count: number; amount: string }>
  totalOutstanding: string
  ledgerBalance: string
  reconciliationDelta: string
  invoiceCount: number
  invoices: ArInvoiceRow[]
}

export type ArStatementLine = {
  id: string
  kind: 'invoice' | 'payment'
  reference: string | null
  occurredAt: string
  debit: string
  credit: string
}

export type ArStatement = {
  customerId: string
  from: string | null
  to: string | null
  currencyCode: string | null
  openingBalance: string
  totalDebits: string
  totalCredits: string
  closingBalance: string
  lines: ArStatementLine[]
}

function isoDay(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

function dayDifference(later: string, earlier: string): number {
  const laterMs = Date.parse(`${later}T00:00:00.000Z`)
  const earlierMs = Date.parse(`${earlier}T00:00:00.000Z`)
  return Math.floor((laterMs - earlierMs) / 86_400_000)
}

export function bucketForDueDate(dueDate: string | null, asOf: string): AgingBucket {
  if (!dueDate) return 'current'
  const overdueDays = dayDifference(asOf, dueDate)
  if (overdueDays <= 0) return 'current'
  if (overdueDays <= 30) return 'days1to30'
  if (overdueDays <= 60) return 'days31to60'
  if (overdueDays <= 90) return 'days61to90'
  return 'days90plus'
}

type InvoiceQueryRow = {
  id: string
  invoice_number: string | null
  customer_entity_id: string | null
  customer_name: string | null
  issue_date: Date | string | null
  due_date: Date | string | null
  currency_code: string
  grand_total_gross_amount: string | null
  outstanding_amount: string | null
}

function toInvoiceRow(row: InvoiceQueryRow, asOf: string): ArInvoiceRow {
  const dueDate = isoDay(row.due_date)
  return {
    id: row.id,
    invoiceNumber: row.invoice_number ?? row.id,
    customerEntityId: row.customer_entity_id,
    customerName: row.customer_name,
    issueDate: isoDay(row.issue_date),
    dueDate,
    currencyCode: row.currency_code,
    grossAmount: decimal(row.grand_total_gross_amount),
    outstandingAmount: decimal(row.outstanding_amount),
    bucket: bucketForDueDate(dueDate, asOf),
  }
}

function decimal(value: string | null | undefined): string {
  return roundDecimalHalfUp(String(value ?? '0'), 2)
}

export async function loadOpenInvoices(em: EntityManager, scope: ArScope, asOf: string): Promise<ArInvoiceRow[]> {
  const rows = await em.getConnection().execute<InvoiceQueryRow[]>(
    `select i.id, i.invoice_number, o.customer_entity_id,
            coalesce(o.customer_snapshot->>'displayName', o.customer_snapshot->>'name') as customer_name,
            i.issue_date, i.due_date, i.currency_code, i.grand_total_gross_amount, i.outstanding_amount
     from sales_invoices i
     left join sales_orders o on o.id = i.order_id
     where i.tenant_id = ? and i.organization_id = ? and i.deleted_at is null
       and i.outstanding_amount > 0
       and (i.status is null or lower(i.status) not in ('draft', 'cancelled', 'void', 'voided'))
     order by i.due_date nulls last, i.issue_date`,
    [scope.tenantId, scope.organizationId],
  )
  return rows.map((row) => toInvoiceRow(row, asOf))
}

export async function loadLedgerReceivableBalance(
  em: EntityManager,
  scope: ArScope,
  asOf: string,
): Promise<string> {
  const rows = await em.getConnection().execute<Array<{ balance: string | null }>>(
    `select coalesce(sum(l.debit_amount - l.credit_amount), 0) as balance
     from gl_journal_lines l
     join gl_journal_entries e on e.id = l.entry_id
     join gl_accounts a on a.id = l.account_id
     where e.tenant_id = ? and e.organization_id = ? and e.status = 'posted'
       and e.posting_date <= ? and a.account_type = 'receivable' and a.deleted_at is null`,
    [scope.tenantId, scope.organizationId, asOf],
  )
  return decimal(rows[0]?.balance)
}

export function buildAging(invoices: ArInvoiceRow[], ledgerBalance: string, asOf: string): ArAging {
  const buckets = Object.fromEntries(
    AGING_BUCKETS.map((bucket) => [bucket, { count: 0, amount: '0.00' }]),
  ) as ArAging['buckets']
  for (const invoice of invoices) {
    const current = buckets[invoice.bucket]
    buckets[invoice.bucket] = {
      count: current.count + 1,
      amount: roundDecimalHalfUp(sumDecimalStrings([current.amount, invoice.outstandingAmount]), 2),
    }
  }
  const totalOutstanding = roundDecimalHalfUp(
    sumDecimalStrings(invoices.map((invoice) => invoice.outstandingAmount)),
    2,
  )
  return {
    asOf,
    currencyCode: invoices[0]?.currencyCode ?? null,
    buckets,
    totalOutstanding,
    ledgerBalance,
    reconciliationDelta: roundDecimalHalfUp(subtractDecimalStrings(ledgerBalance, totalOutstanding), 2),
    invoiceCount: invoices.length,
    invoices,
  }
}

type StatementQueryRow = {
  id: string
  kind: 'invoice' | 'payment'
  reference: string | null
  occurred_at: Date | string
  debit: string | null
  credit: string | null
}

export async function loadCustomerStatement(
  em: EntityManager,
  scope: ArScope,
  customerId: string,
  range: { from?: string | null; to?: string | null },
): Promise<ArStatement> {
  const from = range.from ?? null
  const to = range.to ?? null
  const rows = await em.getConnection().execute<StatementQueryRow[]>(
    `select i.id, 'invoice' as kind, i.invoice_number as reference,
            coalesce(i.issue_date, i.created_at) as occurred_at,
            i.grand_total_gross_amount as debit, '0' as credit
     from sales_invoices i
     join sales_orders o on o.id = i.order_id
     where i.tenant_id = ? and i.organization_id = ? and i.deleted_at is null
       and o.customer_entity_id = ?
       and (?::date is null or coalesce(i.issue_date, i.created_at)::date >= ?::date)
       and (?::date is null or coalesce(i.issue_date, i.created_at)::date <= ?::date)
     union all
     select p.id, 'payment' as kind, p.payment_reference as reference,
            coalesce(p.received_at, p.created_at) as occurred_at,
            '0' as debit, p.amount as credit
     from sales_payments p
     join sales_orders o on o.id = p.order_id
     where p.tenant_id = ? and p.organization_id = ? and p.deleted_at is null
       and o.customer_entity_id = ?
       and (p.status is null or lower(p.status) not in ('void', 'voided', 'cancelled'))
       and (?::date is null or coalesce(p.received_at, p.created_at)::date >= ?::date)
       and (?::date is null or coalesce(p.received_at, p.created_at)::date <= ?::date)
     order by occurred_at`,
    [
      scope.tenantId, scope.organizationId, customerId, from, from, to, to,
      scope.tenantId, scope.organizationId, customerId, from, from, to, to,
    ],
  )
  const lines: ArStatementLine[] = rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    reference: row.reference ?? null,
    occurredAt: new Date(row.occurred_at).toISOString(),
    debit: decimal(row.debit),
    credit: decimal(row.credit),
  }))
  const totalDebits = roundDecimalHalfUp(sumDecimalStrings(lines.map((line) => line.debit)), 2)
  const totalCredits = roundDecimalHalfUp(sumDecimalStrings(lines.map((line) => line.credit)), 2)
  return {
    customerId,
    from,
    to,
    currencyCode: null,
    openingBalance: '0.00',
    totalDebits,
    totalCredits,
    closingBalance: roundDecimalHalfUp(subtractDecimalStrings(totalDebits, totalCredits), 2),
    lines,
  }
}
