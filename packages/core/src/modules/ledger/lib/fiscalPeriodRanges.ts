/**
 * Calendar-month ranges for "generate 12 months" (PR #5663 review, point 3).
 *
 * The model accepts any non-overlapping date range; this only produces the
 * usual case in one step: consecutive calendar months starting on the first
 * day of the month the caller names. Dates are UTC midnight, the same as the
 * `date` values the create command receives.
 */

export const GENERATED_PERIOD_MONTHS = 12

export type DateRange = { startDate: Date; endDate: Date }

/** `true` when `date` is the first day of a month (UTC). */
export function isFirstOfMonth(date: Date): boolean {
  return date.getUTCDate() === 1
}

/** `count` consecutive calendar months starting at `start` (a first-of-month date). */
export function monthRanges(start: Date, count: number = GENERATED_PERIOD_MONTHS): DateRange[] {
  const year = start.getUTCFullYear()
  const month = start.getUTCMonth()
  return Array.from({ length: count }, (_, index) => ({
    startDate: new Date(Date.UTC(year, month + index, 1)),
    endDate: new Date(Date.UTC(year, month + index + 1, 0)),
  }))
}
