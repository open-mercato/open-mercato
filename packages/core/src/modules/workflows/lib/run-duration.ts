/**
 * Run duration formatting (spec §8.3) — PURE.
 *
 * One implementation so the overview card, the per-step inspector, the Gantt
 * axis and the run list cannot each round a duration differently.
 */

const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

export function toMillis(value: string | Date | null | undefined): number | null {
  if (!value) return null
  const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * Human-readable elapsed time. Sub-second durations keep their milliseconds
 * because an automated step that takes 8ms and one that takes 800ms are not
 * the same thing to whoever is debugging the run.
 */
export function formatDurationMs(durationMs: number): string {
  const value = Math.max(durationMs, 0)
  if (value < SECOND_MS) return `${Math.round(value)}ms`
  if (value < MINUTE_MS) return `${(value / SECOND_MS).toFixed(value < 10 * SECOND_MS ? 1 : 0)}s`
  if (value < HOUR_MS) {
    return `${Math.floor(value / MINUTE_MS)}m ${Math.floor((value % MINUTE_MS) / SECOND_MS)}s`
  }
  if (value < DAY_MS) {
    return `${Math.floor(value / HOUR_MS)}h ${Math.floor((value % HOUR_MS) / MINUTE_MS)}m`
  }
  return `${Math.floor(value / DAY_MS)}d ${Math.floor((value % DAY_MS) / HOUR_MS)}h`
}

/**
 * Duration between two timestamps, preferring an engine-measured value when
 * one was recorded. Returns `null` when nothing can be derived, so callers
 * render a dash rather than a misleading `0ms`.
 */
export function formatRunDuration(
  startedAt: string | Date | null | undefined,
  endedAt: string | Date | null | undefined,
  measuredMs?: number | null
): string | null {
  if (typeof measuredMs === 'number' && Number.isFinite(measuredMs)) {
    return formatDurationMs(measuredMs)
  }
  const start = toMillis(startedAt)
  if (start === null) return null
  const end = toMillis(endedAt)
  if (end === null) return null
  return formatDurationMs(end - start)
}

/**
 * Elapsed time for a run that has not finished — measured against `now` rather
 * than left blank, so a stuck instance reads as stuck.
 */
export function formatElapsedSince(
  startedAt: string | Date | null | undefined,
  endedAt: string | Date | null | undefined,
  now: number = Date.now()
): string | null {
  const start = toMillis(startedAt)
  if (start === null) return null
  const end = toMillis(endedAt) ?? now
  return formatDurationMs(end - start)
}
