export type Iso8601DurationParts = {
  years: number
  months: number
  weeks: number
  days: number
  hours: number
  minutes: number
  seconds: number
}

/**
 * Full ISO 8601 duration grammar: `P[nY][nM][nW][nD][T[nH][nM][nS]]`.
 *
 * The lookaheads reject the designator-only forms `P`, `PT` and `P1DT`, and the
 * anchors reject anything with trailing junk. `M` before `T` is months, `M`
 * after it is minutes — the distinction the hand-rolled parsers this replaces
 * could not make.
 */
const ISO_8601_DURATION_PATTERN =
  /^P(?=\d|T\d)(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?=\d)(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/

const SIMPLE_DURATION_PATTERN = /^(\d+)(d|h|m|s)$/

const MS_PER_SECOND = 1000
const MS_PER_MINUTE = 60 * MS_PER_SECOND
const MS_PER_HOUR = 60 * MS_PER_MINUTE
const MS_PER_DAY = 24 * MS_PER_HOUR

/**
 * Parse an ISO 8601 duration into its calendar components.
 *
 * Pure and total: returns `null` for anything that is not a valid ISO 8601
 * duration, so callers decide how to surface the problem.
 *
 * @param duration - Duration string (e.g. "PT30M", "P1W", "P1DT12H")
 * @returns Parsed components, or `null` when the string is not ISO 8601
 */
export function parseIso8601Duration(duration: string): Iso8601DurationParts | null {
  const match = duration.match(ISO_8601_DURATION_PATTERN)
  if (!match) return null

  return {
    years: parseInt(match[1] || '0', 10),
    months: parseInt(match[2] || '0', 10),
    weeks: parseInt(match[3] || '0', 10),
    days: parseInt(match[4] || '0', 10),
    hours: parseInt(match[5] || '0', 10),
    minutes: parseInt(match[6] || '0', 10),
    seconds: parseInt(match[7] || '0', 10),
  }
}

/**
 * Add an ISO 8601 duration to a date using calendar arithmetic.
 *
 * Years, months, weeks and days advance the calendar (so "P1M" lands on the
 * same day of the next month whatever its length), while hours, minutes and
 * seconds are added as elapsed time.
 *
 * @param from - Anchor date
 * @param parts - Parsed duration components
 * @returns A new date; `from` is never mutated
 */
export function addIso8601Duration(from: Date, parts: Iso8601DurationParts): Date {
  const result = new Date(from.getTime())

  if (parts.years) result.setFullYear(result.getFullYear() + parts.years)
  if (parts.months) result.setMonth(result.getMonth() + parts.months)

  const days = parts.weeks * 7 + parts.days
  if (days) result.setDate(result.getDate() + days)

  const elapsedMs =
    parts.hours * MS_PER_HOUR + parts.minutes * MS_PER_MINUTE + parts.seconds * MS_PER_SECOND

  return elapsedMs ? new Date(result.getTime() + elapsedMs) : result
}

/**
 * Parse a duration to milliseconds
 *
 * Supports:
 * - ISO 8601: PT30M (30 minutes), PT1H (1 hour), P1D (1 day), P1W (1 week), P1DT12H
 * - Simple formats: 5m, 1h, 3d, 30s
 *
 * Years and months are rejected here because they have no fixed millisecond
 * length — use `parseIso8601Duration` + `addIso8601Duration` when the duration
 * is anchored to a date.
 *
 * @param duration - Duration string
 * @returns Duration in milliseconds
 */
export function parseDuration(duration: string): number {
  const parts = parseIso8601Duration(duration)

  if (parts) {
    if (parts.years || parts.months) {
      throw new Error(
        `Duration ${duration} uses years or months, which have no fixed length in milliseconds`
      )
    }

    return (
      (parts.weeks * 7 + parts.days) * MS_PER_DAY +
      parts.hours * MS_PER_HOUR +
      parts.minutes * MS_PER_MINUTE +
      parts.seconds * MS_PER_SECOND
    )
  }

  const simpleMatch = duration.match(SIMPLE_DURATION_PATTERN)

  if (simpleMatch) {
    const value = parseInt(simpleMatch[1], 10)

    switch (simpleMatch[2]) {
      case 'd':
        return value * MS_PER_DAY
      case 'h':
        return value * MS_PER_HOUR
      case 'm':
        return value * MS_PER_MINUTE
      case 's':
        return value * MS_PER_SECOND
    }
  }

  throw new Error(`Invalid duration format: ${duration}`)
}

/**
 * Resolve a deadline from a duration anchored to a point in time.
 *
 * Accepts every format `parseDuration` accepts plus the calendar-only ISO 8601
 * components (years, months), which are applied as calendar arithmetic. Throws
 * on an unparseable duration — a deadline the author got wrong must surface,
 * never quietly become some default.
 *
 * @param duration - Duration string (e.g. "PT30M", "P3D", "P1DT12H")
 * @param from - Anchor date, defaults to now
 * @returns The resolved deadline
 */
export function calculateDueDate(duration: string, from: Date = new Date()): Date {
  const parts = parseIso8601Duration(duration)
  if (parts) return addIso8601Duration(from, parts)

  return new Date(from.getTime() + parseDuration(duration))
}

const ISO_DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
const ISO_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/

function utcDate(year: number, monthIndex: number, day: number, hours = 0, minutes = 0, seconds = 0, ms = 0): Date {
  const date = new Date(Date.UTC(2000, 0, 1, hours, minutes, seconds, ms))
  date.setUTCFullYear(year, monthIndex, day)
  return date
}

function isCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false
  return day <= utcDate(year, month, 0).getUTCDate()
}

/**
 * Parse an ABSOLUTE deadline (`userTaskConfig.deadline.at`, already
 * interpolated) into an instant, or `null` when it is not one.
 *
 * Deliberately strict, because a deadline the author got wrong must surface
 * rather than quietly become some other date:
 * - an ISO date (`2026-10-20`) means the END of that day in UTC
 *   (`23:59:59.999Z`) — "due on the 20th" is not breached at its first minute;
 * - an ISO datetime MUST carry `Z` or an explicit offset, because a naive one
 *   would be read in whatever timezone the worker process happens to run in;
 * - a `Date` instance is accepted as-is (a context value set in-process);
 * - anything else — free text, an impossible calendar date (`2026-02-30`),
 *   a template that did not resolve, an empty value — is `null`.
 */
export function parseAbsoluteDeadline(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value !== 'string') return null
  const text = value.trim()

  const dateOnly = ISO_DATE_ONLY.exec(text)
  if (dateOnly) {
    const [year, month, day] = dateOnly.slice(1, 4).map(Number)
    if (!isCalendarDate(year, month, day)) return null
    return utcDate(year, month - 1, day, 23, 59, 59, 999)
  }

  const dateTime = ISO_DATE_TIME.exec(text)
  if (!dateTime) return null
  const [year, month, day, hour, minute, second] = dateTime.slice(1, 7).map((part) => Number(part ?? 0))
  if (!isCalendarDate(year, month, day) || hour > 23 || minute > 59 || second > 59) return null
  const instant = new Date(text)
  return Number.isNaN(instant.getTime()) ? null : instant
}

export function calculateWaitDelayMs(config: { duration?: string; until?: string }): number {
  if (config.until) {
    const targetDate = new Date(config.until)
    if (isNaN(targetDate.getTime())) {
      throw new Error(`WAIT activity: invalid "until" datetime: ${config.until}`)
    }
    const delayMs = targetDate.getTime() - Date.now()
    return Math.max(0, delayMs)
  }

  if (config.duration) {
    return parseDuration(config.duration)
  }

  throw new Error('WAIT activity requires "duration" (e.g., "PT5M", "1h") or "until" (ISO 8601 datetime)')
}

/**
 * Normalize a timeout value to milliseconds
 *
 * Accepts every shape the activity editors and stored definitions carry:
 * - a millisecond number (30000)
 * - a millisecond string ("30000") — what the CrudForm activity editor writes,
 *   and what its own placeholder ("PT30S or 30000") tells the user to type
 * - a duration string ("PT30S", "5m")
 *
 * Returns undefined for an absent or unusable value rather than throwing, so a
 * malformed timeout never fails an activity that would otherwise succeed.
 *
 * @param value - Raw timeout value
 * @returns Milliseconds, or undefined when the value is absent or unusable
 */
export function toTimeoutMs(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : undefined
  }
  if (typeof value !== 'string') return undefined

  const trimmed = value.trim()
  if (!trimmed) return undefined

  if (/^\d+$/.test(trimmed)) {
    const milliseconds = Number(trimmed)
    return milliseconds > 0 ? milliseconds : undefined
  }

  try {
    const milliseconds = parseDuration(trimmed)
    return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : undefined
  } catch {
    return undefined
  }
}
