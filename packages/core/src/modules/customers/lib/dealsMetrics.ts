import type { RateResult } from '@open-mercato/core/modules/currencies/services/exchangeRateService'
import {
  absDecimal,
  compareDecimals,
  decimalToNumber,
  decimalToString,
  divideDecimals,
  parseDecimal,
  roundDecimal,
  toDecimal,
  type DecimalValue,
} from '@open-mercato/shared/lib/decimal'

/**
 * Quarter / period helpers for the deals KPI summary. Computed in **UTC** so the
 * window boundaries are stable regardless of the server timezone — `expected_close_at`
 * is a bare `Date` (date-only) while `created_at` / `updated_at` are timestamptz, and
 * mixing local-time boundaries would misbucket deals near a quarter edge.
 */

export type PeriodWindow = {
  /** Inclusive lower bound (UTC). */
  start: Date
  /** Exclusive upper bound (UTC). */
  end: Date
}

export type TrailingMonth = {
  /** Inclusive lower bound (UTC) of the month bucket. */
  start: Date
  /** 'YYYY-MM' label for the bucket. */
  label: string
}

export type DeltaDirection = 'up' | 'down' | 'unchanged'

export type Delta = {
  value: number
  direction: DeltaDirection
}

export type CurrencySum = {
  currency: string
  total: number
  totalExact?: string
}

export type AmountEntry = {
  currency: string | null
  amount: string
}

export type ExactCurrencySum = CurrencySum & { totalExact: string }

export type ConvertedAmount = {
  value: number
  valueExact: string
  currencyCode: string | null
}

export type ConvertedSums = {
  total: number
  totalExact: string
  convertedAll: boolean
  missingRateCurrencies: string[]
}

function startOfQuarterUtc(year: number, quarterStartMonth: number): Date {
  return new Date(Date.UTC(year, quarterStartMonth, 1, 0, 0, 0, 0))
}

/**
 * Returns the [start, end) window of the calendar quarter that contains `now`,
 * in UTC. Quarters are fixed 3-month blocks: Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec.
 * `end` is exclusive (the start of the next quarter).
 */
export function getQuarterWindow(now: Date): PeriodWindow {
  const year = now.getUTCFullYear()
  const quarterIndex = Math.floor(now.getUTCMonth() / 3)
  const startMonth = quarterIndex * 3
  const start = startOfQuarterUtc(year, startMonth)
  const end = startOfQuarterUtc(year, startMonth + 3)
  return { start, end }
}

/**
 * Returns the [start, end) window of the quarter immediately preceding the one
 * that contains `now`, in UTC. `end` is exclusive and equals the current quarter's start.
 */
export function getPreviousQuarterWindow(now: Date): PeriodWindow {
  const current = getQuarterWindow(now)
  const start = startOfQuarterUtc(current.start.getUTCFullYear(), current.start.getUTCMonth() - 3)
  return { start, end: current.start }
}

function monthLabel(year: number, monthIndex: number): string {
  const month = monthIndex + 1
  return `${year}-${month < 10 ? `0${month}` : month}`
}

/**
 * Returns `count` trailing month buckets ending with the month that contains `now`,
 * ordered oldest → newest. Each bucket exposes its UTC start and a 'YYYY-MM' label.
 * Used to drive the win-rate sparkline series.
 */
export function getTrailingMonths(now: Date, count: number): TrailingMonth[] {
  const buckets: TrailingMonth[] = []
  const baseYear = now.getUTCFullYear()
  const baseMonth = now.getUTCMonth()
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const start = new Date(Date.UTC(baseYear, baseMonth - offset, 1, 0, 0, 0, 0))
    buckets.push({ start, label: monthLabel(start.getUTCFullYear(), start.getUTCMonth()) })
  }
  return buckets
}

/**
 * Percentage change of `current` relative to `previous`, rounded to whole percent.
 * When there is no previous-period baseline, avoid reporting artificial growth.
 */
export function computeDelta(current: number, previous: number): Delta {
  if (previous === 0) {
    return { value: 0, direction: 'unchanged' }
  }
  const change = ((current - previous) / Math.abs(previous)) * 100
  const value = Math.round(change)
  if (value > 0) return { value, direction: 'up' }
  if (value < 0) return { value, direction: 'down' }
  return { value: 0, direction: 'unchanged' }
}

function extractRate(result: RateResult | undefined): DecimalValue | null {
  if (!result || result.rates.length === 0) return null
  const rate = parseDecimal(result.rates[0].rate)
  if (!rate || rate.lte(0)) return null
  return rate
}

/**
 * Converts per-currency sums to the tenant base currency, mirroring the conversion
 * logic in `api/deals/aggregate/route.ts`:
 *  - the base currency stays 1:1,
 *  - other currencies multiply by the rate from `rates` (keyed `"FROM/BASE"`),
 *  - a currency with no usable rate is excluded from `total` and flagged in
 *    `missingRateCurrencies` (with `convertedAll: false`).
 *
 * Amounts and rates are combined with exact decimal math, preferring each entry's
 * `totalExact` over its float `total`. `total` is rounded to whole units for KPI
 * display; `totalExact` carries the unrounded converted sum.
 *
 * When `baseCode` is null there is no base currency configured, so nothing can be
 * converted: every present currency is reported as missing and `convertedAll` is false.
 *
 * `rates` accepts the `Map<string, RateResult>` shape returned by
 * `exchangeRateService.getRates` so callers can pass its output directly.
 */
export function convertSumsToBase(
  perCurrency: CurrencySum[],
  baseCode: string | null,
  rates: ReadonlyMap<string, RateResult> | null,
): ConvertedSums {
  if (!baseCode) {
    const missing = Array.from(
      new Set(perCurrency.map((entry) => entry.currency).filter((code): code is string => Boolean(code))),
    )
    return { total: 0, totalExact: '0', convertedAll: missing.length === 0, missingRateCurrencies: missing }
  }

  let total = toDecimal(0)
  let convertedAll = true
  const missingRateCurrencies: string[] = []
  for (const entry of perCurrency) {
    if (!entry.currency) continue
    const amount = parseDecimal(entry.totalExact ?? entry.total) ?? toDecimal(0)
    if (entry.currency === baseCode) {
      total = total.plus(amount)
      continue
    }
    const rate = extractRate(rates?.get(`${entry.currency}/${baseCode}`))
    if (rate !== null) {
      total = total.plus(amount.times(rate))
    } else {
      convertedAll = false
      if (!missingRateCurrencies.includes(entry.currency)) {
        missingRateCurrencies.push(entry.currency)
      }
    }
  }
  return {
    total: decimalToNumber(roundDecimal(total, 0)),
    totalExact: decimalToString(total),
    convertedAll,
    missingRateCurrencies,
  }
}

export function normalizeCurrencyCode(currency: string | null | undefined): string {
  return (currency ?? '').toString().trim().toUpperCase()
}

/**
 * Sums amounts per currency with exact decimal math, in first-seen currency order.
 * Entries without a currency are skipped.
 */
export function sumsByCurrency(entries: AmountEntry[]): ExactCurrencySum[] {
  const sums: Array<{ currency: string; total: DecimalValue }> = []
  for (const entry of entries) {
    const currency = normalizeCurrencyCode(entry.currency)
    if (!currency) continue
    const amount = parseDecimal(entry.amount) ?? toDecimal(0)
    const existing = sums.find((sum) => sum.currency === currency)
    if (existing) {
      existing.total = existing.total.plus(amount)
    } else {
      sums.push({ currency, total: amount })
    }
  }
  return sums.map((sum) => ({
    currency: sum.currency,
    total: decimalToNumber(sum.total),
    totalExact: decimalToString(sum.total),
  }))
}

/**
 * Degraded path when no base currency is configured: the sum of the currency with
 * the largest absolute total. `value` is rounded to whole units for KPI display;
 * `valueExact` is the unrounded sum.
 */
export function dominantCurrencyAmount(entries: AmountEntry[]): ConvertedAmount {
  let best: ExactCurrencySum | null = null
  for (const sum of sumsByCurrency(entries)) {
    if (!best || compareDecimals(absDecimal(sum.totalExact), absDecimal(best.totalExact)) > 0) best = sum
  }
  if (!best) return { value: 0, valueExact: '0', currencyCode: null }
  return {
    value: decimalToNumber(roundDecimal(best.totalExact, 0)),
    valueExact: best.totalExact,
    currencyCode: best.currency,
  }
}

/**
 * Exact average amount (`totalExact / count`) rounded to `decimalPlaces`;
 * `'0'` when there is nothing to average.
 */
export function averageAmountExact(totalExact: string, count: number, decimalPlaces: number): string {
  if (count <= 0) return '0'
  return decimalToString(roundDecimal(divideDecimals(totalExact, count, decimalPlaces), decimalPlaces))
}
