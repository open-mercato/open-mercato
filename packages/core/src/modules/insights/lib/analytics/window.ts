import { AnalyticsInvalidWindowError, AnalyticsWindowTooLargeError } from './errors'
import {
  XRAY_ANALYTICS_LIMITS,
  XRAY_WINDOW_DAYS,
  type ResolvedWindowView,
  type WindowInput,
  type XrayWindowKey,
} from './types'

const DAY_MS = 24 * 60 * 60 * 1000

export type CalendarDate = {
  year: number
  month: number
  day: number
}

type ZonedParts = CalendarDate & {
  hour: number
  minute: number
  second: number
}

/** A half-open analytics window `[from, to)` in UTC instants, with the zone it was resolved in. */
export type ResolvedWindow = {
  fromMs: number
  toMs: number
  from: string
  to: string
  windowKey: XrayWindowKey | null
  timeZone: string
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone)
  if (cached) return cached
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  formatters.set(timeZone, formatter)
  return formatter
}

/** The IANA zone in its canonical spelling; an unknown zone is an invalid window. */
export function assertTimeZone(timeZone: string): string {
  let canonical: string
  try {
    canonical = formatterFor(timeZone).resolvedOptions().timeZone
  } catch {
    throw new AnalyticsInvalidWindowError('invalid_time_zone')
  }
  formatterFor(canonical)
  return canonical
}

export function zonedDateParts(utcMs: number, timeZone: string): ZonedParts {
  const values: Record<string, number> = {}
  for (const part of formatterFor(timeZone).formatToParts(new Date(utcMs))) {
    if (part.type === 'literal') continue
    values[part.type] = Number.parseInt(part.value, 10)
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour === 24 ? 0 : values.hour,
    minute: values.minute,
    second: values.second,
  }
}

/** Offset of the zone from UTC at an instant: local wall-clock time minus UTC, in ms. */
export function timeZoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = zonedDateParts(utcMs, timeZone)
  const wallClock = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return wallClock - Math.floor(utcMs / 1000) * 1000
}

export function shiftCalendarDate(date: CalendarDate, days: number): CalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days))
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() }
}

function sameDate(left: CalendarDate, right: CalendarDate): boolean {
  return left.year === right.year && left.month === right.month && left.day === right.day
}

/**
 * The first instant of a calendar date in a zone (its local midnight, or the end of a DST gap
 * when midnight is skipped). Two offset passes cover both sides of a transition.
 */
export function zonedMidnightUtc(date: CalendarDate, timeZone: string): number {
  const guess = Date.UTC(date.year, date.month - 1, date.day)
  const first = guess - timeZoneOffsetMs(guess, timeZone)
  const second = guess - timeZoneOffsetMs(first, timeZone)
  const candidates = Array.from(new Set([first, second]))
    .filter((candidate) => sameDate(zonedDateParts(candidate, timeZone), date))
    .sort((left, right) => left - right)
  return candidates[0] ?? first
}

export function localCalendarDate(utcMs: number, timeZone: string): CalendarDate {
  const parts = zonedDateParts(utcMs, timeZone)
  return { year: parts.year, month: parts.month, day: parts.day }
}

function isoOf(ms: number): string {
  return new Date(ms).toISOString()
}

function buildWindow(fromMs: number, toMs: number, windowKey: XrayWindowKey | null, timeZone: string): ResolvedWindow {
  return { fromMs, toMs, from: isoOf(fromMs), to: isoOf(toMs), windowKey, timeZone }
}

/**
 * A default window: the last `days` calendar days of the zone, today included, from the local
 * midnight `days - 1` days ago to the local midnight that ends today. Stable for a whole local
 * day, so its rollup row (keyed by the window start) is recomputed in place during the day.
 */
export function resolveDefaultWindow(windowKey: XrayWindowKey, nowMs: number, timeZone: string): ResolvedWindow {
  const zone = assertTimeZone(timeZone)
  const today = localCalendarDate(nowMs, zone)
  const days = XRAY_WINDOW_DAYS[windowKey]
  const fromMs = zonedMidnightUtc(shiftCalendarDate(today, -(days - 1)), zone)
  const toMs = zonedMidnightUtc(shiftCalendarDate(today, 1), zone)
  return buildWindow(fromMs, toMs, windowKey, zone)
}

/**
 * Resolves a requested window. A custom `{ from, to }` must be non-empty and at most
 * `maxDays` long (exactly `maxDays` is allowed); a longer one is refused with
 * `AnalyticsWindowTooLargeError` (HTTP 422 with a hint to run a background analysis).
 */
export function resolveWindow(
  input: WindowInput,
  options: { nowMs: number; timeZone: string; maxDays?: number },
): ResolvedWindow {
  const zone = assertTimeZone(options.timeZone)
  if ('windowKey' in input) return resolveDefaultWindow(input.windowKey, options.nowMs, zone)
  const fromMs = Date.parse(input.from)
  const toMs = Date.parse(input.to)
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) throw new AnalyticsInvalidWindowError('invalid_bounds')
  if (toMs <= fromMs) throw new AnalyticsInvalidWindowError('empty_window')
  const maxDays = options.maxDays ?? XRAY_ANALYTICS_LIMITS.maxWindowDays
  if (toMs - fromMs > maxDays * DAY_MS) throw new AnalyticsWindowTooLargeError(maxDays)
  return buildWindow(fromMs, toMs, null, zone)
}

/**
 * Equal-length comparison windows: the current window is clipped to `now` (a window still in
 * progress is never compared with a complete one) and the previous window is the span of the
 * same length right before it.
 */
export function comparisonWindows(window: ResolvedWindow, nowMs: number): { current: ResolvedWindow; previous: ResolvedWindow; lengthMs: number } {
  const effectiveToMs = nowMs > window.fromMs ? Math.min(window.toMs, nowMs) : window.toMs
  const lengthMs = effectiveToMs - window.fromMs
  return {
    current: buildWindow(window.fromMs, effectiveToMs, null, window.timeZone),
    previous: buildWindow(window.fromMs - lengthMs, window.fromMs, null, window.timeZone),
    lengthMs,
  }
}

export function toWindowView(window: ResolvedWindow): ResolvedWindowView {
  return { from: window.from, to: window.to, windowKey: window.windowKey, timeZone: window.timeZone }
}

export function isInWindow(atMs: number, window: Pick<ResolvedWindow, 'fromMs' | 'toMs'>): boolean {
  return atMs >= window.fromMs && atMs < window.toMs
}
