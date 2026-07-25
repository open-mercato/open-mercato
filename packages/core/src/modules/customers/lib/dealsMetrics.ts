import type { RateResult } from '@open-mercato/core/modules/currencies/services/exchangeRateService'

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
}

export type ConvertedSums = {
  total: number
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

function extractRate(result: RateResult | undefined): number | null {
  if (!result || result.rates.length === 0) return null
  const rate = Number(result.rates[0].rate)
  if (!Number.isFinite(rate) || rate <= 0) return null
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
 * When `baseCode` is null there is no base currency configured, so nothing can be
 * converted: every present currency is reported as missing and `convertedAll` is false.
 *
 * `rates` accepts the `Map<string, RateResult>` shape returned by
 * `exchangeRateService.getRates` so callers can pass its output directly.
 */
export function convertSumsToBase(
  perCurrency: CurrencySum[],
  baseCode: string | null,
  rates: Map<string, RateResult>,
): ConvertedSums {
  if (!baseCode) {
    const missing = Array.from(
      new Set(perCurrency.map((entry) => entry.currency).filter((code): code is string => Boolean(code))),
    )
    return { total: 0, convertedAll: missing.length === 0, missingRateCurrencies: missing }
  }

  let total = 0
  let convertedAll = true
  const missingRateCurrencies: string[] = []
  for (const entry of perCurrency) {
    if (!entry.currency) continue
    if (entry.currency === baseCode) {
      total += entry.total
      continue
    }
    const rate = extractRate(rates.get(`${entry.currency}/${baseCode}`))
    if (rate !== null) {
      total += entry.total * rate
    } else {
      convertedAll = false
      if (!missingRateCurrencies.includes(entry.currency)) {
        missingRateCurrencies.push(entry.currency)
      }
    }
  }
  return { total: Math.round(total), convertedAll, missingRateCurrencies }
}
