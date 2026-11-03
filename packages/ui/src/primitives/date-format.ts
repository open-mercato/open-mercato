import { format as formatDateFns } from 'date-fns/format'
import { parseISO } from 'date-fns/parseISO'
import type { Locale } from 'date-fns/locale'
import { normalizeDateFormatPattern } from '@open-mercato/shared/lib/date-locale/validation'
import type { ResolvedDateLocaleSettings } from '@open-mercato/shared/lib/date-locale/types'
import { getActiveDateLocaleSettings } from './date-locale-store'

type LocaleLike = Locale | string | null | undefined

export type DisplaySettings = Pick<
  ResolvedDateLocaleSettings,
  'locale' | 'dateFormat' | 'dateTimeFormat' | 'timeFormat' | 'timeZone'
>

const DAY_FIRST_LOCALE_CODES = new Set([
  'pl', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'ru', 'cs', 'sk', 'hu', 'ro',
])

function getLocaleCode(locale?: LocaleLike): string {
  if (!locale) return ''
  if (typeof locale === 'string') return locale.split('-')[0]?.toLowerCase() ?? ''
  return locale.code?.split('-')[0]?.toLowerCase() ?? ''
}

export { normalizeDateFormatPattern }

export function deriveDateDisplayFormat(locale?: LocaleLike): string {
  const code = getLocaleCode(locale)
  return code && DAY_FIRST_LOCALE_CODES.has(code) ? 'd MMM yyyy' : 'MMM d, yyyy'
}

export function resolvePublicDateFormat(locale?: LocaleLike, explicitFormat?: string | null): string {
  return (
    normalizeDateFormatPattern(explicitFormat)
    ?? normalizeDateFormatPattern(process.env.NEXT_PUBLIC_OM_DATE_FORMAT)
    ?? normalizeDateFormatPattern(process.env.NEXT_PUBLIC_DATE_FORMAT)
    ?? deriveDateDisplayFormat(locale)
  )
}

export function resolvePublicDateTimeFormat(locale?: LocaleLike, explicitFormat?: string | null): string {
  const dateFormat = deriveDateDisplayFormat(locale)
  return (
    normalizeDateFormatPattern(explicitFormat)
    ?? normalizeDateFormatPattern(process.env.NEXT_PUBLIC_OM_DATE_TIME_FORMAT)
    ?? normalizeDateFormatPattern(process.env.NEXT_PUBLIC_DATE_TIME_FORMAT)
    ?? normalizeDateFormatPattern(process.env.NEXT_PUBLIC_OM_DATE_FORMAT)
    ?? normalizeDateFormatPattern(process.env.NEXT_PUBLIC_DATE_FORMAT)
    ?? `${dateFormat} HH:mm`
  )
}

export function formatWithPublicDateFormat(date: Date, format: string, locale?: Locale): string | null {
  try {
    return formatDateFns(date, format, locale ? { locale } : undefined)
  } catch {
    return null
  }
}

/**
 * The configured pattern for a date rendered as static text, or `null` when none is set.
 *
 * `null` is the interesting case: with no override the format comes from `Intl`, which knows the
 * ordering and month naming of every locale. A pattern heuristic does not — it can only ask
 * "day first or not", which is wrong for `ko` (year first) and for `de` (numeric, dotted). Those
 * are two of the five locales this repo ships, and this resolver feeds every backend table.
 *
 * ISO stays the contract for machine-facing values — `toDateInputValue`, storage, serialization —
 * never for a label.
 *
 * A pattern is a deliberate operator pin: it wins over the locale entirely, and month tokens render
 * in English on that path — `NEXT_PUBLIC_OM_DATE_FORMAT=d MMM yyyy` gives `1 Jul 2026` to a `pl`
 * tenant, not `1 lip 2026`. Set a numeric pattern, or leave it unset and let `Intl` localize.
 */
export function resolveDisplayDateFormat(settings: DisplaySettings = getActiveDateLocaleSettings()): string | null {
  return settings.dateFormat
}

/**
 * As `resolveDisplayDateFormat`, for a value that carries a real time of day.
 *
 * The date vars are in the chain, and used bare, because a caller that sets only a date pattern has
 * said how a date should look and said nothing about time — appending `HH:mm` would invent a
 * requirement. This is the precedence `resolvePublicDateTimeFormat` already uses.
 */
export function resolveDisplayDateTimeFormat(settings: DisplaySettings = getActiveDateLocaleSettings()): string | null {
  return settings.dateTimeFormat
}

/** As `resolveDisplayDateFormat`, for a time of day on its own. */
export function resolveDisplayTimeFormat(settings: DisplaySettings = getActiveDateLocaleSettings()): string | null {
  return settings.timeFormat
}

/**
 * **ISO-8601 input only.** `parseISO` rejects shapes `new Date` would have accepted — `'July 1, 2026'`,
 * `'2026/07/01'` — so those now return `null` and the caller renders its empty label. Every in-repo
 * caller passes ISO; `DataTable.tryParseDate` keeps a `new Date` fallback because its input is
 * arbitrary column data, while these helpers' is not.
 *
 * `parseISO`, not `new Date`: a bare `yyyy-MM-dd` names a calendar day, and `new Date` reads it as
 * UTC midnight — which `format` then renders as the PREVIOUS day in every zone west of UTC. On a
 * date-only string `parseISO` returns local midnight of the stored day, so the day survives; a value
 * carrying a time or an offset keeps its instant either way.
 */
function parseDisplayValue(value: string | Date | null | undefined): Date | null {
  if (value == null) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = parseISO(trimmed)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function intlLocale(locale?: LocaleLike): string | undefined {
  if (!locale) return undefined
  return typeof locale === 'string' ? locale : locale.code
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** A bare `yyyy-MM-dd` names a calendar day, not an instant: it must never move between zones. */
function isCalendarDay(value: string | Date | null | undefined): boolean {
  return typeof value === 'string' && DATE_ONLY_PATTERN.test(value.trim())
}

const DISPLAY_STYLES = {
  date: { dateStyle: 'medium' },
  datetime: { dateStyle: 'medium', timeStyle: 'short' },
  time: { timeStyle: 'short' },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>

type DisplayStyle = keyof typeof DISPLAY_STYLES

// Constructing an `Intl.DateTimeFormat` costs ~40x using one (Node 24: ~31 µs vs ~0.8 µs), and these
// helpers render every date cell AND its tooltip in `DataTable` — two constructions per cell, so a
// 100-row page with two date columns would pay 400 of them on every sort, filter and keystroke.
// A formatter is immutable and the key space is the locales and zones a deployment ships, so one
// instance per (locale, zone, style) is kept for the process.
const formatterCache = new Map<string, Intl.DateTimeFormat>()

function getFormatter(locale: string | undefined, style: DisplayStyle, timeZone?: string | null): Intl.DateTimeFormat {
  const key = `${locale ?? ''}|${timeZone ?? ''}|${style}`
  const cached = formatterCache.get(key)
  if (cached) return cached
  const created = new Intl.DateTimeFormat(locale, timeZone ? { ...DISPLAY_STYLES[style], timeZone } : DISPLAY_STYLES[style])
  formatterCache.set(key, created)
  return created
}

const wallClockFormatterCache = new Map<string, Intl.DateTimeFormat>()

function getWallClockFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = wallClockFormatterCache.get(timeZone)
  if (cached) return cached
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  wallClockFormatterCache.set(timeZone, created)
  return created
}

/**
 * The wall-clock reading of `date` in `timeZone`, as a local `Date` whose getters return that
 * reading. Lets a `date-fns` pattern render an instant in a zone other than the runtime's, the
 * same technique `date-fns-tz` `toZonedTime` uses. Returns `date` unchanged when the zone is
 * unknown.
 */
export function toZonedWallClock(date: Date, timeZone: string | null | undefined): Date {
  if (!timeZone) return date
  try {
    const parts = getWallClockFormatter(timeZone).formatToParts(date)
    const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0)
    return new Date(read('year'), read('month') - 1, read('day'), read('hour'), read('minute'), read('second'), date.getMilliseconds())
  } catch {
    return date
  }
}

function formatDisplay(
  value: string | Date | null | undefined,
  locale: LocaleLike,
  style: DisplayStyle,
  pattern: string | null,
  settings: DisplaySettings,
): string | null {
  const parsed = parseDisplayValue(value)
  if (!parsed) return null
  const calendarDay = isCalendarDay(value)
  const timeZone = calendarDay ? null : settings.timeZone
  if (pattern) return formatWithPublicDateFormat(toZonedWallClock(parsed, timeZone), pattern)
  const formatLocale = settings.locale ?? intlLocale(locale)
  try {
    return getFormatter(formatLocale, style, timeZone).format(parsed)
  } catch {
    return getFormatter(intlLocale(locale), style).format(parsed)
  }
}

/**
 * Render a date for display, or `null` when there is nothing valid to show.
 *
 * `settings` defaults to the active tenant/user settings (see `DateLocaleSettingsProvider`). A
 * bare `yyyy-MM-dd` renders as that calendar day in every zone; an instant renders in the
 * configured timezone.
 */
export function formatDisplayDate(
  value: string | Date | null | undefined,
  locale?: LocaleLike,
  settings: DisplaySettings = getActiveDateLocaleSettings(),
): string | null {
  return formatDisplay(value, locale, 'date', resolveDisplayDateFormat(settings), settings)
}

/** Render a timestamp for display, or `null` when there is nothing valid to show. */
export function formatDisplayDateTime(
  value: string | Date | null | undefined,
  locale?: LocaleLike,
  settings: DisplaySettings = getActiveDateLocaleSettings(),
): string | null {
  return formatDisplay(value, locale, 'datetime', resolveDisplayDateTimeFormat(settings), settings)
}

/** Render the time of day of a timestamp, or `null` when there is nothing valid to show. */
export function formatDisplayTime(
  value: string | Date | null | undefined,
  locale?: LocaleLike,
  settings: DisplaySettings = getActiveDateLocaleSettings(),
): string | null {
  return formatDisplay(value, locale, 'time', resolveDisplayTimeFormat(settings), settings)
}

/**
 * Today's calendar day (`yyyy-MM-dd`) in the configured display timezone, or in the runtime zone
 * when none is configured. Use instead of `new Date().toISOString().slice(0, 10)`, which names the
 * UTC day and is wrong near midnight everywhere except UTC.
 */
export function todayInZone(timeZone: string | null | undefined = getActiveDateLocaleSettings().timeZone, now: Date = new Date()): string {
  return formatDateFns(toZonedWallClock(now, timeZone), 'yyyy-MM-dd')
}

/**
 * The **local** calendar day of a real instant, as the `yyyy-MM-dd` an `<input type="date">` requires.
 *
 * Not `new Date(value).toISOString().slice(0, 10)`: `toISOString` converts to UTC first, so east of
 * UTC an evening timestamp yields the previous day. Rendering that through `formatDisplayDate` is
 * faithful to a day that was already wrong.
 *
 * **Precondition: `value` must be a real instant** — a moment that happened, whose local day is the
 * one a human would name. It must NOT be a date-only value that some write path stored as UTC
 * midnight: reading that back locally names the PREVIOUS day west of UTC, which is the mirror image
 * of the bug above. Use `toUtcDateInputValue` for those; see its note for how to tell them apart.
 */
export function toDateInputValue(value: string | Date | null | undefined): string | null {
  const parsed = parseDisplayValue(value)
  return parsed ? formatWithPublicDateFormat(parsed, 'yyyy-MM-dd') : null
}

/**
 * The **UTC** calendar day of a value, as the `yyyy-MM-dd` an `<input type="date">` requires.
 *
 * For a column that stores a date-only value as UTC midnight — a bare `yyyy-MM-dd` submitted by a
 * date input, coerced with `z.coerce.date()` and returned as `…T00:00:00.000Z`. The stored instant
 * carries no local meaning, so the round trip only closes if it is read back in the same frame it
 * was written in: UTC.
 *
 * Which helper a field needs is decided by its WRITE path, not by its type. If the value can be set
 * from a date input, it is a UTC day; if it is only ever stamped from a clock, it is an instant.
 */
export function toUtcDateInputValue(value: string | Date | null | undefined): string | null {
  if (value == null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    // A bare calendar day is already the answer. Parsing it into an instant first — by either
    // reading — can only move it, since there is no zone in which it was meant.
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
    const parsed = new Date(trimmed)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
  }
  return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10)
}
