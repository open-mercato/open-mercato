import { withExactAmounts, withExactListAmounts } from '@open-mercato/shared/lib/decimal'
import { EXTERNAL_HEADER_FIELDS } from './calculations'

export const LINE_EXACT_AMOUNT_FIELDS = [
  'unitPriceNet',
  'unitPriceGross',
  'discountAmount',
  'taxAmount',
  'totalNetAmount',
  'totalGrossAmount',
] as const

export const ADJUSTMENT_EXACT_AMOUNT_FIELDS = ['amountNet', 'amountGross'] as const

export const DOCUMENT_TOTAL_EXACT_AMOUNT_FIELDS = [
  'subtotalNetAmount',
  'subtotalGrossAmount',
  'discountTotalAmount',
  'taxTotalAmount',
  'grandTotalNetAmount',
  'grandTotalGrossAmount',
  'paidTotalAmount',
  'outstandingAmount',
] as const

export const PAYMENT_EXACT_AMOUNT_FIELDS = ['amount', 'capturedAmount', 'refundedAmount'] as const

export const PAYMENT_ALLOCATION_EXACT_AMOUNT_FIELDS = ['amount'] as const

export const SHIPMENT_EXACT_AMOUNT_FIELDS = ['declaredValueNet', 'declaredValueGross'] as const

export const SHIPPING_METHOD_EXACT_AMOUNT_FIELDS = ['baseRateNet', 'baseRateGross'] as const

type ParsedRecord = Record<string, unknown>

function listOf(parsed: ParsedRecord, key: string): ParsedRecord[] | undefined {
  const value = parsed[key]
  return Array.isArray(value) ? (value as ParsedRecord[]) : undefined
}

function withExactList<T extends ParsedRecord>(
  parsed: T,
  raw: unknown,
  key: string,
  fields: readonly string[],
): T {
  const items = withExactListAmounts(listOf(parsed, key), raw, key, fields)
  return items ? ({ ...parsed, [key]: items } as T) : parsed
}

/**
 * API routes parse the body before the command runs, which turns amounts into
 * floats. These helpers attach `<field>Exact` strings taken from the raw body so
 * the command still sees every digit.
 */
export function withExactDocumentInput<T extends ParsedRecord>(parsed: T, raw: unknown): T {
  const withRate = withExactAmounts(parsed, raw, ['exchangeRate', ...EXTERNAL_HEADER_FIELDS] as const)
  const withLines = withExactList(withRate, raw, 'lines', LINE_EXACT_AMOUNT_FIELDS)
  return withExactList(withLines, raw, 'adjustments', ADJUSTMENT_EXACT_AMOUNT_FIELDS)
}

export function withExactInvoiceInput<T extends ParsedRecord>(parsed: T, raw: unknown): T {
  const withTotals = withExactAmounts(parsed, raw, DOCUMENT_TOTAL_EXACT_AMOUNT_FIELDS)
  return withExactList(withTotals, raw, 'lines', LINE_EXACT_AMOUNT_FIELDS)
}

/** Attaches exact strings to the header totals a line write on an external order restates. */
export function withExactOrderTotalsInput<T extends ParsedRecord>(parsed: T, raw: unknown): T {
  const totals = parsed.orderTotals
  if (!totals || typeof totals !== 'object') return parsed
  const rawTotals = raw && typeof raw === 'object' ? (raw as ParsedRecord).orderTotals : undefined
  return { ...parsed, orderTotals: withExactAmounts(totals as ParsedRecord, rawTotals, EXTERNAL_HEADER_FIELDS) }
}

export function withExactLineInput<T extends ParsedRecord>(parsed: T, raw: unknown): T {
  return withExactOrderTotalsInput(withExactAmounts(parsed, raw, LINE_EXACT_AMOUNT_FIELDS), raw)
}

export function withExactAdjustmentInput<T extends ParsedRecord>(parsed: T, raw: unknown): T {
  return withExactAmounts(parsed, raw, ADJUSTMENT_EXACT_AMOUNT_FIELDS)
}

export function withExactPaymentInput<T extends ParsedRecord>(parsed: T, raw: unknown): T {
  const withAmounts = withExactAmounts(parsed, raw, PAYMENT_EXACT_AMOUNT_FIELDS)
  return withExactList(withAmounts, raw, 'allocations', PAYMENT_ALLOCATION_EXACT_AMOUNT_FIELDS)
}

export function withExactShipmentInput<T extends ParsedRecord>(parsed: T, raw: unknown): T {
  return withExactAmounts(parsed, raw, SHIPMENT_EXACT_AMOUNT_FIELDS)
}

export function withExactShippingMethodInput<T extends ParsedRecord>(parsed: T, raw: unknown): T {
  return withExactAmounts(parsed, raw, SHIPPING_METHOD_EXACT_AMOUNT_FIELDS)
}
