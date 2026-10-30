import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('planner').child({ component: 'availability' })

const FALLBACK_TIME_ZONE = 'UTC'
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * Availability rows store `timezone` as free-form `text`, so a malformed value
 * must not turn a read or a write into a 500. Unknown zones degrade to UTC,
 * which is already how the expander interprets every stored instant.
 */
export function resolveTimeZone(value: string | null | undefined): string {
  if (!isResolvableTimeZone(value)) return FALLBACK_TIME_ZONE
  return value.trim()
}

export function isResolvableTimeZone(value: string | null | undefined): value is string {
  if (typeof value !== 'string' || !value.trim().length) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value.trim() })
    return true
  } catch {
    return false
  }
}

/**
 * The replace endpoints anchor `DTSTART` in the declared zone, so an
 * unresolvable value is persisted as a UTC-anchored instant under a label
 * nothing can resolve. Rejecting it with a 400 would narrow the replace
 * schemas (a `data/validators.ts` contract surface), so for now the write is
 * accepted and flagged; the 400 is announced in UPGRADE_NOTES.md.
 */
export function warnOnUnresolvableTimeZone(value: string, commandId: string): void {
  if (isResolvableTimeZone(value)) return
  logger.warn('[deprecated] Unresolvable availability timezone anchored to UTC; this will be rejected with 400 in a future minor release', {
    commandId,
    timezone: value,
    fallback: FALLBACK_TIME_ZONE,
  })
}

function parseTimeOfDay(value: string): { hours: number; minutes: number } | null {
  const [hours, minutes] = String(value).split(':').map((part) => Number(part))
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return { hours, minutes }
}

type WallClock = { year: number; month: number; day: number; hours: number; minutes: number; seconds: number }

const MINUTE_MS = 60 * 1000
const DAY_MS = 24 * 60 * MINUTE_MS
const formatterCache = new Map<string, Intl.DateTimeFormat>()

function zonedFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatterCache.set(timeZone, formatter)
  }
  return formatter
}

/**
 * Wall clock of an instant in `timeZone`, read through `Intl` only. `date-fns-tz`
 * seeds its offset search with host-local getters, so around DST transitions
 * the same input resolved differently depending on the serving machine's `TZ`.
 */
function zonedWallClock(epochMs: number, timeZone: string): WallClock {
  const values: Record<string, number> = {}
  for (const part of zonedFormatter(timeZone).formatToParts(new Date(epochMs))) {
    if (part.type !== 'literal') values[part.type] = Number(part.value)
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hours: values.hour,
    minutes: values.minute,
    seconds: values.second,
  }
}

function wallClockAsUtc(clock: WallClock): number {
  return Date.UTC(clock.year, clock.month - 1, clock.day, clock.hours, clock.minutes, clock.seconds)
}

function offsetAt(epochMs: number, timeZone: string): number {
  const flooredToMinute = Math.floor(epochMs / MINUTE_MS) * MINUTE_MS
  return wallClockAsUtc(zonedWallClock(flooredToMinute, timeZone)) - flooredToMinute
}

function parseDateKey(dateKey: string): { year: number; month: number; day: number } | null {
  if (!DATE_KEY_PATTERN.test(String(dateKey))) return null
  const [year, month, day] = dateKey.split('-').map((part) => Number(part))
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null
  return { year, month, day }
}

function formatUtcDateKey(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10)
}

/**
 * `2026-06-15` + `09:00` + `Europe/Warsaw` → the absolute instant that wall
 * time denotes. Replaces `new Date(y, m, d, h, min)`, whose result depended on
 * the host process's `TZ` rather than on the zone the caller declared (#5862).
 *
 * DST transitions follow the `compatible` disambiguation of RFC 5545 §3.3.5 and
 * Temporal: a repeated wall time resolves to its EARLIER occurrence, and a
 * skipped one moves forward by the length of the gap (`Africa/Cairo` has no
 * 2026-04-24 00:00, so it becomes 01:00 — the first instant of that date).
 */
export function zonedWallTimeToInstant(dateKey: string, time: string, timeZone: string): Date | null {
  const date = parseDateKey(dateKey)
  const parsed = parseTimeOfDay(time)
  if (!date || !parsed) return null
  const wall = new Date(Date.UTC(date.year, date.month - 1, date.day, parsed.hours, parsed.minutes))
  return zonedWallDateToInstant(wall, timeZone)
}

/** Resolve a UTC-encoded wall clock with compatible DST disambiguation. */
export function zonedWallDateToInstant(wall: Date, timeZone: string): Date {
  const zone = resolveTimeZone(timeZone)
  const wallAsUtc = wall.getTime()
  const offsetBefore = offsetAt(wallAsUtc - DAY_MS, zone)
  const offsetAfter = offsetAt(wallAsUtc + DAY_MS, zone)
  if (offsetBefore === offsetAfter) return new Date(wallAsUtc - offsetBefore)
  const candidates = [wallAsUtc - offsetBefore, wallAsUtc - offsetAfter].sort((left, right) => left - right)
  const matching = candidates.find((candidate) => candidate + offsetAt(candidate, zone) === wallAsUtc)
  return new Date(matching ?? wallAsUtc - offsetBefore)
}

/**
 * The span a full-day block covers: from the first instant of `dateKey` to the
 * first instant of the following date, both in `timeZone`. That is 23 or 25
 * hours on DST days, so the block neither bleeds into nor falls short of its
 * neighbours.
 */
export function zonedDayBounds(dateKey: string, timeZone: string): { start: Date; end: Date } | null {
  const date = parseDateKey(dateKey)
  if (!date) return null
  const nextDateKey = formatUtcDateKey(Date.UTC(date.year, date.month - 1, date.day) + DAY_MS)
  const start = zonedWallTimeToInstant(dateKey, '00:00', timeZone)
  const end = zonedWallTimeToInstant(nextDateKey, '00:00', timeZone)
  if (!start || !end || end <= start) return null
  return { start, end }
}

/**
 * The calendar date an instant falls on, as seen from `timeZone`.
 *
 * Which day an existing rule belongs to has to be read in that rule's own zone,
 * the same zone its `DTSTART` was anchored in. Derived from the host clock
 * instead, replace-by-date selected a different set of rows — and the 403 gate
 * in `api/availability-date-specific.ts` admitted or refused the same request —
 * depending on which machine served it.
 */
export function zonedDateKey(instant: Date, timeZone: string): string {
  const clock = zonedWallClock(instant.getTime(), resolveTimeZone(timeZone))
  return formatUtcDateKey(Date.UTC(clock.year, clock.month - 1, clock.day))
}

/** `Date.getDay()` index (0 = Sunday) of an instant, as seen from `timeZone`. */
export function zonedWeekday(instant: Date, timeZone: string): number {
  const clock = zonedWallClock(instant.getTime(), resolveTimeZone(timeZone))
  return new Date(Date.UTC(clock.year, clock.month - 1, clock.day)).getUTCDay()
}

/**
 * The next occurrence of `weekday` (0 = Sunday) at or after `from`, as a
 * calendar date key in `timeZone`. The zone matters: at 12:00 UTC on a Monday
 * it is already Tuesday in `Pacific/Auckland`, which shifted the whole series
 * by a week before this was zone-aware.
 */
export function nextWeekdayDateKey(weekday: number, timeZone: string, from: Date = new Date()): string {
  const clock = zonedWallClock(from.getTime(), resolveTimeZone(timeZone))
  const localMidnight = Date.UTC(clock.year, clock.month - 1, clock.day)
  const diff = (weekday - new Date(localMidnight).getUTCDay() + 7) % 7
  return formatUtcDateKey(localMidnight + diff * DAY_MS)
}

/**
 * The start and end instants of the occurrence a weekly window is anchored on.
 *
 * The anchor's exact length becomes the rule's `DURATION`, which every reader
 * applies to every week. An anchor that spans a DST transition (Europe/Warsaw
 * Sunday 00:00–08:00 on 2026-10-25 lasts 9 hours) or starts in a gap would
 * therefore misstate the window for all ordinary weeks, so the upcoming
 * occurrence is used only when both local endpoints and its exact length match
 * the request; otherwise the previous week's occurrence anchors the series. Taking
 * the earlier week keeps the upcoming occurrence inside the series for readers
 * that expand forward from `DTSTART`.
 *
 * `from` is threaded in rather than defaulted per call: resolving a window's
 * start and end against two separate `new Date()` reads can straddle midnight
 * in the declared zone, which lands the anchors seven days apart.
 */
export function zonedWeeklyAnchor(
  weekday: number,
  startTime: string,
  endTime: string,
  timeZone: string,
  from: Date,
): { start: Date; end: Date } | null {
  const startClock = parseTimeOfDay(startTime)
  const endClock = parseTimeOfDay(endTime)
  if (!startClock || !endClock) return null
  const zone = resolveTimeZone(timeZone)
  const startMinutes = startClock.hours * 60 + startClock.minutes
  const endMinutes = endClock.hours * 60 + endClock.minutes
  const localLengthMs = (endMinutes - startMinutes) * MINUTE_MS
  const upcoming = parseDateKey(nextWeekdayDateKey(weekday, timeZone, from))
  if (!upcoming) return null
  const upcomingMidnight = Date.UTC(upcoming.year, upcoming.month - 1, upcoming.day)
  let fallback: { start: Date; end: Date } | null = null
  for (const weekOffset of [0, -1]) {
    const midnight = upcomingMidnight + weekOffset * 7 * DAY_MS
    const dateKey = formatUtcDateKey(midnight)
    const start = zonedWallTimeToInstant(dateKey, startTime, timeZone)
    const end = zonedWallTimeToInstant(dateKey, endTime, timeZone)
    if (!start || !end) return null
    const startWall = wallClockAsUtc(zonedWallClock(start.getTime(), zone))
    const endWall = wallClockAsUtc(zonedWallClock(end.getTime(), zone))
    if (startWall !== midnight + startMinutes * MINUTE_MS || endWall !== midnight + endMinutes * MINUTE_MS) continue
    if (end.getTime() - start.getTime() === localLengthMs) return { start, end }
    fallback ??= { start, end }
  }
  return fallback
}
