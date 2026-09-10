import { addDays, format } from 'date-fns'
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz'

const FALLBACK_TIME_ZONE = 'UTC'
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * Availability rows store `timezone` as free-form `text`, so a malformed value
 * must not turn a read or a write into a 500. Unknown zones degrade to UTC,
 * which is already how the expander interprets every stored instant.
 */
export function resolveTimeZone(value: string | null | undefined): string {
  if (typeof value !== 'string' || !value.trim().length) return FALLBACK_TIME_ZONE
  const candidate = value.trim()
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate })
    return candidate
  } catch {
    return FALLBACK_TIME_ZONE
  }
}

function parseTimeOfDay(value: string): { hours: number; minutes: number } | null {
  const [hours, minutes] = String(value).split(':').map((part) => Number(part))
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return { hours, minutes }
}

/**
 * `2026-06-15` + `09:00` + `Europe/Warsaw` → the absolute instant that wall
 * time denotes. Replaces `new Date(y, m, d, h, min)`, whose result depended on
 * the host process's `TZ` rather than on the zone the caller declared (#5862).
 */
export function zonedWallTimeToInstant(dateKey: string, time: string, timeZone: string): Date | null {
  if (!DATE_KEY_PATTERN.test(String(dateKey))) return null
  const parsed = parseTimeOfDay(time)
  if (!parsed) return null
  const hours = String(parsed.hours).padStart(2, '0')
  const minutes = String(parsed.minutes).padStart(2, '0')
  const instant = fromZonedTime(`${dateKey}T${hours}:${minutes}:00`, resolveTimeZone(timeZone))
  return Number.isNaN(instant.getTime()) ? null : instant
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
  return formatInTimeZone(instant, resolveTimeZone(timeZone), 'yyyy-MM-dd')
}

/** `Date.getDay()` index (0 = Sunday) of an instant, as seen from `timeZone`. */
export function zonedWeekday(instant: Date, timeZone: string): number {
  return toZonedTime(instant, resolveTimeZone(timeZone)).getDay()
}

/**
 * The next occurrence of `weekday` (0 = Sunday) at or after `from`, as a
 * calendar date key in `timeZone`. The zone matters: at 12:00 UTC on a Monday
 * it is already Tuesday in `Pacific/Auckland`, which shifted the whole series
 * by a week before this was zone-aware.
 */
export function nextWeekdayDateKey(weekday: number, timeZone: string, from: Date = new Date()): string {
  const local = toZonedTime(from, resolveTimeZone(timeZone))
  const diff = (weekday - local.getDay() + 7) % 7
  return format(addDays(local, diff), 'yyyy-MM-dd')
}
