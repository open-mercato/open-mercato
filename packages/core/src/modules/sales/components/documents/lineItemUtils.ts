"use client"

export function normalizeNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return fallback
}

/**
 * A catalog price is only usable on a line when it carries a positive amount, because line
 * submission rejects a unit price of zero. Returns the amount for the requested mode, falling
 * back to the other mode, or `null` when neither amount is positive.
 */
export function resolveCatalogPriceAmount(
  amountNet: number | null | undefined,
  amountGross: number | null | undefined,
  mode: 'net' | 'gross',
): number | null {
  const isPositive = (value: number | null | undefined): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0
  const [preferred, fallback] = mode === 'net' ? [amountNet, amountGross] : [amountGross, amountNet]
  if (isPositive(preferred)) return preferred
  if (isPositive(fallback)) return fallback
  return null
}

/**
 * Pass `locale` to format in the application locale (`useLocale()` in client components).
 * Omitting it keeps the runtime default, which varies per machine and is therefore not
 * assertable in tests.
 */
export function formatMoney(value: number, currency: string | null | undefined, locale?: string): string {
  if (!currency) return value.toFixed(2)
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value)
}

export type LineDiscountDisplay = {
  amount: number | null
  percent: number | null
}

type LineDiscountSource = {
  discountAmount?: unknown
  discountPercent?: unknown
  unitPriceNet?: unknown
  quantity?: unknown
}

const DISCOUNT_MATCH_TOLERANCE = 0.01
const DISCOUNT_MATCH_TOLERANCE_PER_UNIT = 0.0001

function percentAccountsForAmount(
  line: LineDiscountSource,
  percent: number,
  amount: number,
): boolean {
  if (percent <= 0) return false
  const quantity = normalizeNumber(line.quantity, 0)
  const netBeforeDiscount = normalizeNumber(line.unitPriceNet, 0) * quantity
  if (netBeforeDiscount <= 0) return false
  const tolerance = Math.max(
    DISCOUNT_MATCH_TOLERANCE,
    quantity * DISCOUNT_MATCH_TOLERANCE_PER_UNIT,
  )
  return Math.abs((percent / 100) * netBeforeDiscount - amount) <= tolerance
}

export function resolveLineDiscountDisplay(
  line: LineDiscountSource,
): LineDiscountDisplay | null {
  const amount = normalizeNumber(line.discountAmount, 0)
  const percent = normalizeNumber(line.discountPercent, 0)
  if (amount > 0) {
    return {
      amount,
      percent: percentAccountsForAmount(line, percent, amount) ? percent : null,
    }
  }
  if (percent > 0) return { amount: null, percent }
  return null
}
