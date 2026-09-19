import { format as formatDateFns } from 'date-fns/format'
import { parseISO } from 'date-fns/parseISO'
import { toZonedTime } from 'date-fns-tz'
import {
  withProfile,
  displayLocale,
  type DisplayHourCycle,
  type DisplayProfile,
  type FirstDayOfWeek,
} from './profile'

export type DateTimeOptions = {
  /** Locale to fall back to when the profile carries no `languageTag`. */
  locale?: string | null
}

/**
 * **ISO-8601 input only**, matching `packages/ui/src/primitives/date-format.ts`.
 *
 * `parseISO`, not `new Date`: a bare `yyyy-MM-dd` names a calendar day, and `new Date` reads it as
 * UTC midnight, which then renders as the PREVIOUS day in every zone west of UTC.
 */
function parseDisplayValue(value: Date | string | null | undefined): Date | null {
  if (value == null) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = parseISO(trimmed)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** True for a bare `yyyy-MM-dd`, which names a calendar day and must never be shifted by a zone. */
function isDateOnly(value: Date | string | null | undefined): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
}

/**
 * Move a stored UTC instant into the market's zone before a pattern is applied.
 *
 * A date-only value is exempt: it never carried a time, so shifting it would invent one and move
 * the day. Without a profile zone the runtime zone applies, which is today's behavior.
 */
function inProfileZone(date: Date, profile: DisplayProfile, dateOnly: boolean): Date {
  if (dateOnly || !profile.timeZone) return date
  try {
    return toZonedTime(date, profile.timeZone)
  } catch {
    return date
  }
}

const INTL_STYLES = {
  date: { dateStyle: 'medium' },
  datetime: { dateStyle: 'medium', timeStyle: 'short' },
  time: { timeStyle: 'short' },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>

// Constructing an `Intl.DateTimeFormat` costs far more than using one, and these helpers render
// every date cell in a table. One instance per (locale, style, zone, cycle) is kept for the process.
const formatterCache = new Map<string, Intl.DateTimeFormat>()

function getFormatter(
  locale: string | undefined,
  style: keyof typeof INTL_STYLES,
  timeZone: string | null,
  cycle: DisplayHourCycle | null,
): Intl.DateTimeFormat {
  const key = `${locale ?? ''}|${style}|${timeZone ?? ''}|${cycle ?? ''}`
  const cached = formatterCache.get(key)
  if (cached) return cached
  const options: Intl.DateTimeFormatOptions = { ...INTL_STYLES[style] }
  if (timeZone) options.timeZone = timeZone
  if (cycle && style !== 'date') options.hour12 = cycle === 'h12'
  let created: Intl.DateTimeFormat
  try {
    created = new Intl.DateTimeFormat(locale, options)
  } catch {
    created = new Intl.DateTimeFormat(locale, INTL_STYLES[style])
  }
  formatterCache.set(key, created)
  return created
}

function formatWithPattern(date: Date, pattern: string): string | null {
  try {
    return formatDateFns(date, pattern)
  } catch {
    return null
  }
}

function render(
  value: Date | string | null | undefined,
  profile: DisplayProfile | null | undefined,
  pattern: string | null,
  style: keyof typeof INTL_STYLES,
  options?: DateTimeOptions,
): string | null {
  const parsed = parseDisplayValue(value)
  if (!parsed) return null
  const resolved = withProfile(profile)
  const dateOnly = isDateOnly(value)

  if (pattern) {
    return formatWithPattern(inProfileZone(parsed, resolved, dateOnly), pattern)
  }
  // No pattern means "let `Intl` decide", which is what an organization without a market gets today.
  return getFormatter(
    displayLocale(profile, options?.locale),
    style,
    dateOnly ? null : resolved.timeZone,
    resolved.hourCycle,
  ).format(parsed)
}

/** Render a date in the market's conventions, or `null` when there is nothing valid to show. */
export function formatDate(
  value: Date | string | null | undefined,
  profile?: DisplayProfile | null,
  options?: DateTimeOptions,
): string | null {
  return render(value, profile, withProfile(profile).dateFormat, 'date', options)
}

/** Render a timestamp in the market's conventions. */
export function formatDateTime(
  value: Date | string | null | undefined,
  profile?: DisplayProfile | null,
  options?: DateTimeOptions,
): string | null {
  return render(value, profile, withProfile(profile).dateTimeFormat, 'datetime', options)
}

/** Render a time of day in the market's conventions. */
export function formatTime(
  value: Date | string | null | undefined,
  profile?: DisplayProfile | null,
  options?: DateTimeOptions,
): string | null {
  return render(value, profile, withProfile(profile).timeFormat, 'time', options)
}

/** Render a date span as `from - to`, collapsing to one date when both sides render the same. */
export function formatDateRange(
  from: Date | string | null | undefined,
  to: Date | string | null | undefined,
  profile?: DisplayProfile | null,
  options?: DateTimeOptions,
): string | null {
  const start = formatDate(from, profile, options)
  const end = formatDate(to, profile, options)
  if (!start && !end) return null
  if (!start) return end
  if (!end) return start
  return start === end ? start : `${start} - ${end}`
}

/** The market's first day of the week, 0 being Sunday. */
export function weekStartsOn(profile?: DisplayProfile | null): FirstDayOfWeek {
  return withProfile(profile).firstDayOfWeek
}

/**
 * The market's hour cycle.
 *
 * `fallback` is required by the call site rather than defaulted here because today's surfaces
 * disagree with each other: the time picker defaults to 12-hour while the schedule grids and the
 * staff timesheet force 24-hour. Each migrated call site passes the value it uses today, so an
 * organization that never picked a market renders exactly as before (spec assumption A5).
 */
export function hourCycle(profile: DisplayProfile | null | undefined, fallback: DisplayHourCycle): DisplayHourCycle {
  return withProfile(profile).hourCycle ?? fallback
}

/** `true` when the market renders a 12-hour clock. Convenience for `hour12` props. */
export function isHour12(profile: DisplayProfile | null | undefined, fallback: DisplayHourCycle): boolean {
  return hourCycle(profile, fallback) === 'h12'
}

/**
 * The `hour12` option to hand `Intl`, or `undefined` to leave the decision to the locale.
 *
 * For the surfaces that pass no `hour12` today and let the runtime locale decide. Returning
 * `undefined` without a profile keeps that exactly, which a required fallback could not express:
 * hardcoding either `true` or `false` would visibly change one of them for every tenant that never
 * picked a market.
 */
export function optionalHour12(profile?: DisplayProfile | null): boolean | undefined {
  const cycle = withProfile(profile).hourCycle
  return cycle === null ? undefined : cycle === 'h12'
}
