import type { EntityManager } from '@mikro-orm/postgresql'
import {
  multiplyDecimalStrings,
  percentOfDecimal,
  roundDecimalHalfUp,
  subtractDecimalStrings,
  sumDecimalStrings,
} from './money'
import { bucketForDueDate, type AgingBucket } from './arService'

/**
 * Accounts-payable arithmetic and read models.
 *
 * Vendor invoice totals are computed from the lines, never accepted from the
 * client: a posted AP entry that trusts a client-supplied total is a way to pay a
 * different amount than the invoice says. Multiplication and percentages use the
 * ledger's decimal helpers, never `number`, for the same reason the rest of the
 * module does.
 */

export type ApScope = { tenantId: string; organizationId: string }

export type ApLineInput = {
  description: string
  expenseAccountId: string
  quantity?: string | number | null
  unitPriceNet?: string | number | null
  totalNetAmount?: string | number | null
  taxRate?: string | number | null
  taxAmount?: string | number | null
  totalGrossAmount?: string | number | null
  taxCode?: string | null
}

export type ApLineComputed = {
  description: string
  expenseAccountId: string
  quantity: string
  unitPriceNet: string
  totalNetAmount: string
  taxRate: string
  taxAmount: string
  totalGrossAmount: string
  taxCode: string | null
}

export type ApInvoiceTotals = {
  lines: ApLineComputed[]
  subtotalNetAmount: string
  taxTotalAmount: string
  grandTotalGrossAmount: string
}

const ZERO = '0.00'

function decimal(value: string | number | null | undefined): string {
  return roundDecimalHalfUp(value ?? 0, 2)
}

export function computeApLine(line: ApLineInput): ApLineComputed {
  const quantity = roundDecimalHalfUp(line.quantity ?? 1, 4)
  const unitPriceNet = roundDecimalHalfUp(line.unitPriceNet ?? 0, 4)
  const net = line.totalNetAmount !== undefined && line.totalNetAmount !== null
    ? decimal(line.totalNetAmount)
    : decimal(multiplyDecimalStrings(quantity, unitPriceNet))
  const taxRate = roundDecimalHalfUp(line.taxRate ?? 0, 4)
  const tax = line.taxAmount !== undefined && line.taxAmount !== null
    ? decimal(line.taxAmount)
    : decimal(percentOfDecimal(net, taxRate))
  return {
    description: line.description,
    expenseAccountId: line.expenseAccountId,
    quantity,
    unitPriceNet,
    totalNetAmount: net,
    taxRate,
    taxAmount: tax,
    totalGrossAmount: roundDecimalHalfUp(sumDecimalStrings([net, tax]), 2),
    taxCode: line.taxCode ?? null,
  }
}

export function computeApInvoiceTotals(lines: ApLineInput[]): ApInvoiceTotals {
  const computed = lines.map(computeApLine)
  return {
    lines: computed,
    subtotalNetAmount: roundDecimalHalfUp(sumDecimalStrings(computed.map((line) => line.totalNetAmount)), 2),
    taxTotalAmount: roundDecimalHalfUp(sumDecimalStrings(computed.map((line) => line.taxAmount)), 2),
    grandTotalGrossAmount: roundDecimalHalfUp(sumDecimalStrings(computed.map((line) => line.totalGrossAmount)), 2),
  }
}

export function computeWithholding(gross: string, rate: number): { withholding: string; net: string } {
  const normalized = roundDecimalHalfUp(gross, 2)
  const withholding = roundDecimalHalfUp(multiplyDecimalStrings(normalized, String(rate)), 2)
  return {
    withholding,
    net: roundDecimalHalfUp(subtractDecimalStrings(normalized, withholding), 2),
  }
}

export type ApAgingInvoice = {
  id: string
  internalNumber: string
  vendorId: string
  vendorName: string | null
  issueDate: string | null
  dueDate: string | null
  currencyCode: string
  grossAmount: string
  paidAmount: string
  outstandingAmount: string
  bucket: AgingBucket
}

export type ApAging = {
  asOf: string
  currencyCode: string | null
  buckets: Record<AgingBucket, { count: number; amount: string }>
  totalOutstanding: string
  ledgerBalance: string
  reconciliationDelta: string
  invoiceCount: number
  invoices: ApAgingInvoice[]
}

type ApInvoiceQueryRow = {
  id: string
  internal_number: string
  vendor_id: string
  vendor_name: string | null
  issue_date: Date | string | null
  due_date: Date | string | null
  currency_code: string
  grand_total_gross_amount: string | null
  paid_amount: string | null
}

function isoDay(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

export async function loadOpenApInvoices(
  em: EntityManager,
  scope: ApScope,
  asOf: string,
): Promise<ApAgingInvoice[]> {
  const rows = await em.getConnection().execute<ApInvoiceQueryRow[]>(
    `select i.id, i.internal_number, i.vendor_id, v.name as vendor_name,
            i.issue_date, i.due_date, i.currency_code, i.grand_total_gross_amount,
            coalesce((
              select sum(a.amount) from ap_payment_allocations a
              join ap_payments p on p.id = a.payment_id
              where a.invoice_id = i.id and p.status = 'posted' and p.deleted_at is null
            ), 0) as paid_amount
     from ap_vendor_invoices i
     left join ap_vendors v on v.id = i.vendor_id
     where i.tenant_id = ? and i.organization_id = ? and i.deleted_at is null
       and i.status in ('posted', 'paid')
     order by i.due_date nulls last, i.issue_date`,
    [scope.tenantId, scope.organizationId],
  )
  return rows
    .map((row) => {
      const dueDate = isoDay(row.due_date)
      const gross = decimal(row.grand_total_gross_amount)
      const outstanding = roundDecimalHalfUp(subtractDecimalStrings(gross, decimal(row.paid_amount)), 2)
      return {
        id: row.id,
        internalNumber: row.internal_number,
        vendorId: row.vendor_id,
        vendorName: row.vendor_name,
        issueDate: isoDay(row.issue_date),
        dueDate,
        currencyCode: row.currency_code,
        grossAmount: gross,
        paidAmount: decimal(row.paid_amount),
        outstandingAmount: outstanding,
        bucket: bucketForDueDate(dueDate, asOf),
      }
    })
    .filter((invoice) => Number(invoice.outstandingAmount) > 0)
}

export async function loadLedgerPayableBalance(
  em: EntityManager,
  scope: ApScope,
  asOf: string,
): Promise<string> {
  const rows = await em.getConnection().execute<Array<{ balance: string | null }>>(
    `select coalesce(sum(l.credit_amount - l.debit_amount), 0) as balance
     from gl_journal_lines l
     join gl_journal_entries e on e.id = l.entry_id
     join gl_accounts a on a.id = l.account_id
     where e.tenant_id = ? and e.organization_id = ? and e.status = 'posted'
       and e.posting_date <= ? and a.account_type = 'payable' and a.deleted_at is null`,
    [scope.tenantId, scope.organizationId, asOf],
  )
  return decimal(rows[0]?.balance)
}

export function buildApAging(
  invoices: ApAgingInvoice[],
  ledgerBalance: string,
  asOf: string,
): ApAging {
  const buckets = Object.fromEntries(
    (['current', 'days1to30', 'days31to60', 'days61to90', 'days90plus'] as AgingBucket[])
      .map((bucket) => [bucket, { count: 0, amount: ZERO }]),
  ) as ApAging['buckets']
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
