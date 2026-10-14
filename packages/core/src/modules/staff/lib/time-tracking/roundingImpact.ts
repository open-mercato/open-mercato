/**
 * Rounding impact projection (T7.2) — the warning card on screen 16.
 *
 * Changing the rounding rule changes what clients are billed, and the effect is
 * invisible until an invoice. The preview answers the only question that matters
 * before saving: at the candidate rule, what would the last 90 days have billed?
 *
 * Two properties this file exists to guarantee:
 *
 *  1. **It rounds through `roundMinutes`, never a second implementation.** A
 *     preview that disagreed with the write path would be worse than no preview.
 *  2. **It rounds per entry, not per sum** (D-7). That is why the projection is
 *     driven by `(durationMinutes, entryCount)` buckets rather than a SQL
 *     `SUM(duration_minutes)`: the database groups identical durations, and each
 *     distinct duration is rounded exactly once and multiplied by its count. The
 *     result is arithmetically identical to rounding every row, at a fraction of
 *     the rows.
 */

import { roundMinutes, type RoundingSettings } from './rounding'

export type DurationBucket = {
  durationMinutes: number
  entryCount: number
}

export type RoundingImpact = {
  entryCount: number
  rawMinutes: number
  roundedMinutes: number
  /** Positive when the rule bills more than the raw time; negative when it bills less. */
  deltaMinutes: number
}

export const EMPTY_ROUNDING_IMPACT: RoundingImpact = {
  entryCount: 0,
  rawMinutes: 0,
  roundedMinutes: 0,
  deltaMinutes: 0,
}

function toCount(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0
}

function toMinutes(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0
}

export function projectRoundingImpact(
  buckets: readonly DurationBucket[],
  settings: RoundingSettings,
): RoundingImpact {
  let entryCount = 0
  let rawMinutes = 0
  let roundedMinutes = 0

  for (const bucket of buckets) {
    const count = toCount(bucket.entryCount)
    if (count === 0) continue
    const duration = toMinutes(bucket.durationMinutes)
    entryCount += count
    rawMinutes += duration * count
    roundedMinutes += roundMinutes(duration, settings) * count
  }

  return {
    entryCount,
    rawMinutes,
    roundedMinutes,
    deltaMinutes: roundedMinutes - rawMinutes,
  }
}
