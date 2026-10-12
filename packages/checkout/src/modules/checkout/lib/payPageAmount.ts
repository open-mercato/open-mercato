import {
  compareDecimals,
  decimalToNumber,
  decimalToString,
  parseDecimal,
  resolveExactDecimal,
} from '@open-mercato/shared/lib/decimal'
import { formatCurrency } from '@open-mercato/ui/utils/format'

/**
 * Client-safe amount helpers for the public pay page. Amounts travel as a
 * `number` (kept for display and injection widgets) plus an exact decimal string
 * so values beyond float precision reach the server unchanged.
 */

export type PayPageAmount = {
  amount: number | null
  amountExact: string | null
}

export type PayPageSubmitBodyInput = {
  amount: number | null
  amountExact?: string | null
}

export type PayPageCustomAmountBounds = {
  customAmountMin?: number | null
  customAmountMinExact?: string | null
  customAmountMax?: number | null
  customAmountMaxExact?: string | null
}

export type PayPageCustomAmountIssue = 'required' | 'min' | 'max'

export function formatPayPageAmount(
  value: number | null | undefined,
  currencyCode?: string | null,
  locale?: string,
  exact?: string | null,
): string {
  return formatCurrency(resolveExactDecimal(exact, value) ?? '0', currencyCode, locale, currencyCode ? undefined : 2, { showAllDigits: true }) ?? ''
}

export function toPayPageAmount(legacy: unknown, exact: unknown): PayPageAmount {
  const amountExact = resolveExactDecimal(exact, legacy)
  if (amountExact == null) return { amount: null, amountExact: null }
  return { amount: decimalToNumber(amountExact), amountExact }
}

export function parsePayPageAmountInput(value: string): PayPageAmount {
  const parsed = parseDecimal(value.trim())
  if (!parsed) return { amount: null, amountExact: null }
  return { amount: decimalToNumber(parsed), amountExact: decimalToString(parsed) }
}

/**
 * Applies an amount set through the pay page form API. Strings are parsed
 * exactly; a number keeps the current exact string only while it still stands
 * for the same value, so a widget changing the number is never overridden.
 */
export function applyPayPageAmountValue(current: PayPageAmount, value: unknown): PayPageAmount {
  if (typeof value === 'string') return parsePayPageAmountInput(value)
  if (typeof value !== 'number' || !Number.isFinite(value)) return { amount: null, amountExact: null }
  return { amount: value, amountExact: resolveExactDecimal(current.amountExact, value) }
}

export function buildPayPageSubmitBody<TData extends PayPageSubmitBodyInput>(
  data: TData,
): Omit<TData, 'amount' | 'amountExact'> & { amount: string | null } {
  const { amount, amountExact, ...rest } = data
  return { ...rest, amount: resolveExactDecimal(amountExact, amount) }
}

export function validatePayPageCustomAmount(
  bounds: PayPageCustomAmountBounds,
  value: PayPageAmount,
): PayPageCustomAmountIssue | null {
  const submitted = resolveExactDecimal(value.amountExact, value.amount)
  if (submitted == null) return 'required'
  const minimum = resolveExactDecimal(bounds.customAmountMinExact, bounds.customAmountMin)
  const maximum = resolveExactDecimal(bounds.customAmountMaxExact, bounds.customAmountMax)
  if (maximum != null && compareDecimals(submitted, maximum) > 0) return 'max'
  if (minimum != null && compareDecimals(submitted, minimum) < 0) return 'min'
  return null
}
