/**
 * Generic line total computation for any line item (deal lines, order lines, invoice lines, etc.).
 * Handles quantity * unit price with optional percent and fixed discounts.
 */

export type LineTotalsInput = {
  quantity: number
  unitPrice: number
  discountPercent?: number | null
  discountAmount?: number | null
  taxRate?: number | null
}

export type LineTotalsOutput = {
  subtotal: number
  discountTotal: number
  taxTotal: number
  total: number
}

/**
 * Compute line totals with configurable decimal precision.
 *
 * Formula:
 * 1. subtotal = quantity * unitPrice
 * 2. percentDiscount = subtotal * (discountPercent / 100)
 * 3. discountTotal = percentDiscount + discountAmount
 * 4. afterDiscount = subtotal - discountTotal
 * 5. taxTotal = afterDiscount * (taxRate / 100)
 * 6. total = afterDiscount + taxTotal
 *
 * @param input - Line item values
 * @param precision - Decimal precision for rounding (default: 2)
 * @returns Computed totals
 */
export function computeLineTotals(input: LineTotalsInput, precision: number = 2): LineTotalsOutput {
  const factor = Math.pow(10, precision)
  const round = (value: number) => Math.round(value * factor) / factor

  const subtotal = round(input.quantity * input.unitPrice)
  const percentDiscount = round(subtotal * ((input.discountPercent ?? 0) / 100))
  const fixedDiscount = input.discountAmount ?? 0
  const discountTotal = round(percentDiscount + fixedDiscount)
  const afterDiscount = Math.max(0, round(subtotal - discountTotal))
  const taxTotal = round(afterDiscount * ((input.taxRate ?? 0) / 100))
  const total = round(afterDiscount + taxTotal)

  return {
    subtotal,
    discountTotal,
    taxTotal,
    total: Math.max(0, total),
  }
}

/**
 * Simple line total without tax (backward compatible with CRM deal lines).
 * Equivalent to: max(0, quantity * unitPrice - percentDiscount - fixedDiscount)
 */
export function computeSimpleLineTotal(
  quantity: number,
  unitPrice: number,
  discountPercent?: number | null,
  discountAmount?: number | null,
): number {
  const gross = quantity * unitPrice
  const percentDisc = gross * ((discountPercent ?? 0) / 100)
  const total = gross - (discountAmount ?? 0) - percentDisc
  return Math.max(0, total)
}
