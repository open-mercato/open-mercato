import { parseDecimal, toDecimal, type DecimalValue } from '@open-mercato/shared/lib/decimal'
import { isClosedDealStatus, isWonDealStatus } from './dealStatus'
import type { DealTimelineCurrencyTotal } from './dealsTimelineTypes'

export type DealTimelineAmountRow = {
  valueAmount: string | number | null
  valueCurrency: string | null
  probability: number | null
  status: string | null
}

type CurrencyAmounts = { open: DecimalValue; weighted: DecimalValue; won: DecimalValue }

export type DealTimelineAmountAccumulator = Map<string, CurrencyAmounts>

const zero = toDecimal(0)
const emptyAmounts: CurrencyAmounts = { open: zero, weighted: zero, won: zero }

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
  const status = row.status?.toLowerCase() ?? null
  const won = isWonDealStatus(status)
  if (!won && isClosedDealStatus(status)) return
  const amount = parseDecimal(row.valueAmount)
  if (!amount) return
  const currency = normalizeCurrency(row.valueCurrency)
  const totals = accumulator.get(currency) ?? emptyAmounts
  if (won) {
    accumulator.set(currency, { ...totals, won: totals.won.plus(amount) })
  } else {
    const weightedAmount = amount.times(clampProbability(row.probability)).times('0.01')
    accumulator.set(currency, {
      ...totals,
      open: totals.open.plus(amount),
      weighted: totals.weighted.plus(weightedAmount),
    })
  }
}

export function mergeTimelineAmounts(
  target: DealTimelineAmountAccumulator,
  source: DealTimelineAmountAccumulator,
): void {
  for (const [currency, totals] of source) {
    const existing = target.get(currency) ?? emptyAmounts
    target.set(currency, {
      open: existing.open.plus(totals.open),
      weighted: existing.weighted.plus(totals.weighted),
      won: existing.won.plus(totals.won),
    })
  }
}

export function summarizeTimelineAmounts(accumulator: DealTimelineAmountAccumulator): DealTimelineCurrencyTotal[] {
  return Array.from(accumulator.entries())
    .map(([currency, totals]) => ({
      currency,
      open: Number(totals.open.toFixed(2)),
      weighted: Number(totals.weighted.toFixed(2)),
      won: Number(totals.won.toFixed(2)),
    }))
    .sort((left, right) => right.open - left.open || left.currency.localeCompare(right.currency))
}
