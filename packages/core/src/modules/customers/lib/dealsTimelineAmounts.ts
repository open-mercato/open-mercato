import { isClosedDealStatus, isWonDealStatus } from './dealStatus'
import type { DealTimelineCurrencyTotal } from './dealsTimelineTypes'

export type DealTimelineAmountRow = {
  valueAmount: number | null
  valueCurrency: string | null
  probability: number | null
  status: string | null
}

type CurrencyCents = { open: number; weighted: number; won: number }

export type DealTimelineAmountAccumulator = Map<string, CurrencyCents>

export function createTimelineAmountAccumulator(): DealTimelineAmountAccumulator {
  return new Map()
}

function normalizeCurrency(value: string | null): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

function clampProbability(value: number | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

/**
 * Adds one deal to the per-currency totals. Open deals feed `open` and the
 * probability-weighted `weighted`; won deals feed `won`; lost/closed deals and deals
 * without a value are ignored. A value without a currency is kept under `''`.
 */
export function addTimelineAmount(accumulator: DealTimelineAmountAccumulator, row: DealTimelineAmountRow): void {
  if (typeof row.valueAmount !== 'number' || !Number.isFinite(row.valueAmount)) return
  const status = row.status?.toLowerCase() ?? null
  const won = isWonDealStatus(status)
  if (!won && isClosedDealStatus(status)) return
  const currency = normalizeCurrency(row.valueCurrency)
  const totals = accumulator.get(currency) ?? { open: 0, weighted: 0, won: 0 }
  const cents = Math.round(row.valueAmount * 100)
  if (won) {
    totals.won += cents
  } else {
    totals.open += cents
    totals.weighted += (cents * clampProbability(row.probability)) / 100
  }
  accumulator.set(currency, totals)
}

export function mergeTimelineAmounts(
  target: DealTimelineAmountAccumulator,
  source: DealTimelineAmountAccumulator,
): void {
  for (const [currency, totals] of source) {
    const existing = target.get(currency) ?? { open: 0, weighted: 0, won: 0 }
    target.set(currency, {
      open: existing.open + totals.open,
      weighted: existing.weighted + totals.weighted,
      won: existing.won + totals.won,
    })
  }
}

export function summarizeTimelineAmounts(accumulator: DealTimelineAmountAccumulator): DealTimelineCurrencyTotal[] {
  return Array.from(accumulator.entries())
    .map(([currency, totals]) => ({
      currency,
      open: totals.open / 100,
      weighted: Math.round(totals.weighted) / 100,
      won: totals.won / 100,
    }))
    .sort((left, right) => right.open - left.open || left.currency.localeCompare(right.currency))
}
