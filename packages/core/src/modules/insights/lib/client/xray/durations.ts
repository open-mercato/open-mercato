import type { XrayDurationsResponse } from './types'

export const XRAY_MEDIAN_MIN_N = 5
export const XRAY_P90_MIN_N = 20

type CompletedCell = XrayDurationsResponse['completed']

export type XrayDurationFigure =
  | { kind: 'value'; valueMs: number; n: number; lowConfidence: boolean }
  | { kind: 'hidden' }
  | { kind: 'empty' }
  | { kind: 'too_few'; n: number; minimum: number }

/**
 * One cycle-time figure of the completed cases: the median (needs n ≥ 5) or the p90 (n ≥ 20),
 * `hidden` when the cell is suppressed for privacy, `empty` without completed cases.
 */
export function cycleTimeFigure(cell: CompletedCell, statistic: 'median' | 'p90'): XrayDurationFigure {
  if (!cell) return { kind: 'hidden' }
  if (cell.empty || cell.stats.n === 0) return { kind: 'empty' }
  const valueMs = statistic === 'median' ? cell.stats.medianMs : cell.stats.p90Ms
  if (valueMs === null) {
    return { kind: 'too_few', n: cell.stats.n, minimum: statistic === 'median' ? XRAY_MEDIAN_MIN_N : XRAY_P90_MIN_N }
  }
  return { kind: 'value', valueMs, n: cell.stats.n, lowConfidence: cell.stats.lowConfidence }
}
