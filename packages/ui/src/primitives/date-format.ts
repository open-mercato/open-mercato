import { format as formatDateFns } from 'date-fns/format'
import { parseISO } from 'date-fns/parseISO'
import type { Locale } from 'date-fns/locale'
import { normalizeDateFormatPattern } from '@open-mercato/shared/lib/date-locale/validation'
import type { ResolvedDateLocaleSettings } from '@open-mercato/shared/lib/date-locale/types'
import { getActiveDateLocaleSettings } from './date-locale-store'
import { enUS } from 'date-fns/locale/en-US'
import { resolveDateFnsLocale } from './date-fns-locales'

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
 * A pattern is a deliberate operator pin: it wins over the locale's ordering, while month and
 * weekday tokens render in the formatting locale (the configured one, else the app locale) for
 * the locales with a bundled date-fns locale — `d MMM yyyy` gives `1 lip 2026` to a `pl` tenant.
 * Other locales fall back to English names on that path.
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

const FLOATING_PATTERN = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/

/**
 * A bare `yyyy-MM-dd` names a calendar day, and a zone-less `yyyy-MM-dd HH:mm` a wall time, not an
 * instant: neither carries an offset to convert from, so they must never move between zones.
 */
function isFloatingValue(value: string | Date | null | undefined): boolean {
  return typeof value === 'string' && FLOATING_PATTERN.test(value.trim())
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

function getFormatter(
  locale: string | undefined,
  style: DisplayStyle,
  timeZone?: string | null,
  hourCycle?: Intl.DateTimeFormatOptions['hourCycle'],
): Intl.DateTimeFormat {
  const key = `${locale ?? ''}|${timeZone ?? ''}|${style}|${hourCycle ?? ''}`
  const cached = formatterCache.get(key)
  if (cached) return cached
  const created = new Intl.DateTimeFormat(locale, {
    ...DISPLAY_STYLES[style],
    ...(timeZone ? { timeZone } : {}),
    ...(hourCycle ? { hourCycle } : {}),
  })
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

type WallClockParts = { year: number; month: number; day: number; hour: number; minute: number; second: number }

function readWallClockParts(date: Date, timeZone: string): WallClockParts {
  const parts = getWallClockFormatter(timeZone).formatToParts(date)
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  return { year: read('year'), month: read('month'), day: read('day'), hour: read('hour'), minute: read('minute'), second: read('second') }
}

/**
 * The wall-clock reading of `date` in `timeZone`, as a local `Date` whose getters return that
 * reading. Lets a `date-fns` pattern render an instant in a zone other than the runtime's, the
 * same technique `date-fns-tz` `toZonedTime` uses. Returns `date` unchanged when the zone is
 * unknown.
 *
 * Known limitation (shared with `toZonedTime`): a wall time that falls in the RUNTIME zone's own
 * DST gap on that same date cannot be represented as a local `Date`, so it renders one hour late.
 * Only patterns that print the hour are affected, and only for the skipped hour of the runtime
 * zone's spring-forward day.
 */
export function toZonedWallClock(date: Date, timeZone: string | null | undefined): Date {
  if (!timeZone) return date
  try {
    const parts = readWallClockParts(date, timeZone)
    // Built at noon and set field by field: the Date constructor reads years 0–99 as 1900–1999.
    const wall = new Date(2000, 0, 1, 12)
    wall.setFullYear(parts.year, parts.month - 1, parts.day)
    wall.setHours(parts.hour, parts.minute, parts.second, date.getMilliseconds())
    return wall
  } catch {
    return date
  }
}

const ZONE_TOKEN_LETTERS = new Set(['X', 'x', 'O', 'z', 't', 'T'])

function offsetMinutesIn(date: Date, timeZone: string): number {
  let parts: WallClockParts
  try {
    parts = readWallClockParts(date, timeZone)
  } catch {
    return -date.getTimezoneOffset()
  }
  const wallAsUtcDate = new Date(Date.UTC(2000, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second))
  wallAsUtcDate.setUTCFullYear(parts.year, parts.month - 1, parts.day)
  const wallAsUtc = wallAsUtcDate.getTime()
  return Math.round((wallAsUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000)
}

function formatOffset(minutes: number, { colon, optionalMinutes }: { colon: boolean; optionalMinutes: boolean }): string {
  const sign = minutes < 0 ? '-' : '+'
  const absolute = Math.abs(minutes)
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0')
  const rest = absolute % 60
  if (optionalMinutes && rest === 0) return `${sign}${hours}`
  return `${sign}${hours}${colon ? ':' : ''}${String(rest).padStart(2, '0')}`
}

function renderZoneToken(letter: string, length: number, date: Date, timeZone: string, locale: string | undefined): string {
  if (letter === 't') return String(Math.floor(date.getTime() / 1000))
  if (letter === 'T') return String(date.getTime())
  const offset = offsetMinutesIn(date, timeZone)
  if (letter === 'X' || letter === 'x') {
    if (letter === 'X' && offset === 0) return 'Z'
    if (length === 1) return formatOffset(offset, { colon: false, optionalMinutes: true })
    return formatOffset(offset, { colon: length === 3 || length === 5, optionalMinutes: false })
  }
  if (letter === 'O') {
    if (offset === 0) return 'GMT'
    if (length === 4) return `GMT${formatOffset(offset, { colon: true, optionalMinutes: false })}`
    const sign = offset < 0 ? '-' : '+'
    const absolute = Math.abs(offset)
    const rest = absolute % 60
    return `GMT${sign}${Math.floor(absolute / 60)}${rest ? `:${String(rest).padStart(2, '0')}` : ''}`
  }
  try {
    const parts = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: length === 4 ? 'long' : 'short' }).formatToParts(date)
    return parts.find((part) => part.type === 'timeZoneName')?.value ?? timeZone
  } catch {
    return timeZone
  }
}

const LONG_FORMAT_WIDTHS = ['short', 'medium', 'long', 'full'] as const

/**
 * Expands the localized `P`/`p` tokens to the locale's own patterns, as `date-fns` does when
 * formatting. Their long time widths (`ppp`, `pppp`) contain `z`, which must be visible to
 * `inlineZoneTokens` to render in the display zone.
 */
function expandLongFormatTokens(pattern: string, locale: Locale = enUS): string {
  const formatLong = locale.formatLong
  if (!formatLong) return pattern
  return pattern
    .split(/('(?:[^']|'')*'?)/)
    .map((part) => {
      if (part.startsWith("'")) return part
      return part.replace(/P+p+|P+|p+/g, (token) => {
        const dateLength = token.match(/P+/)?.[0].length ?? 0
        const timeLength = token.match(/p+/)?.[0].length ?? 0
        if (dateLength > 4 || timeLength > 4) return token
        const date = dateLength ? formatLong.date({ width: LONG_FORMAT_WIDTHS[dateLength - 1] }) : ''
        const time = timeLength ? formatLong.time({ width: LONG_FORMAT_WIDTHS[timeLength - 1] }) : ''
        if (!dateLength) return time
        if (!timeLength) return date
        return formatLong
          .dateTime({ width: LONG_FORMAT_WIDTHS[dateLength - 1] })
          .replace('{{date}}', date)
          .replace('{{time}}', time)
      })
    })
    .join('')
}

/**
 * `date-fns` renders zone (`X x O z`) and epoch (`t T`) tokens from the runtime's own offset, but
 * patterns are formatted on a wall-clock `Date` shifted into `timeZone` (`toZonedWallClock`). Those
 * tokens are therefore resolved here, for the real instant in `timeZone`, and inlined as quoted
 * literals; every other token (and quoted text) is left to `date-fns`.
 */
function inlineZoneTokens(pattern: string, date: Date, timeZone: string, locale: string | undefined): string {
  let output = ''
  let index = 0
  while (index < pattern.length) {
    const char = pattern[index]
    if (char === "'") {
      const close = pattern.indexOf("'", index + 1)
      const end = close === -1 ? pattern.length : close + 1
      output += pattern.slice(index, end)
      index = end
      continue
    }
    if (ZONE_TOKEN_LETTERS.has(char)) {
      let end = index
      while (pattern[end] === char) end += 1
      const rendered = renderZoneToken(char, end - index, date, timeZone, locale)
      output += `'${rendered.replace(/'/g, "''")}'`
      index = end
      continue
    }
    output += char
    index += 1
  }
  return output
}

function hourCycleOfPattern(pattern: string | null | undefined): Intl.DateTimeFormatOptions['hourCycle'] {
  if (!pattern) return undefined
  const unquoted = pattern.replace(/'(?:[^']|'')*'?/g, '')
  if (unquoted.includes('H')) return 'h23'
  if (unquoted.includes('h')) return 'h12'
  if (unquoted.includes('k')) return 'h24'
  if (unquoted.includes('K')) return 'h11'
  return undefined
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
  const timeZone = isFloatingValue(value) ? null : settings.timeZone
  const formatLocale = settings.locale ?? intlLocale(locale)
  if (pattern) {
    const dateFnsLocale = resolveDateFnsLocale(formatLocale)
    const zonedPattern = timeZone
      ? inlineZoneTokens(expandLongFormatTokens(pattern, dateFnsLocale), parsed, timeZone, formatLocale)
      : pattern
    return formatWithPublicDateFormat(toZonedWallClock(parsed, timeZone), zonedPattern, dateFnsLocale)
  }
  // A pinned time pattern with no date-time pattern still decides the clock of Intl timestamps, so
  // choosing `HH:mm` makes every date-time 24-hour, not only time-only values.
  const hourCycle = style === 'datetime' ? hourCycleOfPattern(settings.timeFormat) : undefined
  return formatWithFallbacks(parsed, style, [formatLocale, intlLocale(locale)], timeZone, hourCycle)
}

/**
 * Formats with the first locale `Intl` accepts, keeping the zone and clock: an unusable locale must
 * not silently move the value into the runtime zone. Only when every locale fails with the zone
 * (an unknown zone) does it fall back to the runtime zone, so a value still renders.
 */
function formatWithFallbacks(
  value: Date,
  style: DisplayStyle,
  locales: Array<string | undefined>,
  timeZone?: string | null,
  hourCycle?: Intl.DateTimeFormatOptions['hourCycle'],
): string {
  for (const candidate of [...locales, undefined]) {
    try {
      return getFormatter(candidate, style, timeZone, hourCycle).format(value)
    } catch {}
  }
  return getFormatter(undefined, style).format(value)
}

/**
 * Render a date for display, or `null` when there is nothing valid to show.
 *
 * `settings` defaults to the active tenant/user settings (see `DateLocaleSettingsProvider`). A
 * bare `yyyy-MM-dd` renders as that calendar day in every zone; an instant renders in the
 * configured timezone. A formatting locale configured in `settings` takes precedence over the
 * `locale` argument, which applies only when none is configured.
 *
 * The default is browser-only: during SSR it is the public env defaults (a module-level value
 * would leak between tenants' requests). A component that renders dates on the server MUST pass
 * `useDateLocaleSettings()` explicitly, as `DataTable` does, or its hydration will not match.
 * Event handlers, effects and data that loads after mount can rely on the default.
 */
export function formatDisplayDate(
  value: string | Date | null | undefined,
  locale?: LocaleLike,
  settings: DisplaySettings = getActiveDateLocaleSettings(),
): string | null {
  return formatDisplay(value, locale, 'date', resolveDisplayDateFormat(settings), settings)
}

/** Render a timestamp for display, or `null` when there is nothing valid to show. Same `settings` and `locale` rules as `formatDisplayDate`. */
export function formatDisplayDateTime(
  value: string | Date | null | undefined,
  locale?: LocaleLike,
  settings: DisplaySettings = getActiveDateLocaleSettings(),
): string | null {
  return formatDisplay(value, locale, 'datetime', resolveDisplayDateTimeFormat(settings), settings)
}

/** Render the time of day of a timestamp, or `null` when there is nothing valid to show. Same `settings` and `locale` rules as `formatDisplayDate`. */
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

export type LocalDisplayValueOptions = {
  withTime?: boolean
  locale?: Locale
  /** A caller-pinned pattern (for example a field-level `displayFormat`); wins over the settings. */
  explicitFormat?: string | null
  settings?: DisplaySettings
}

/**
 * Render a value a user picked on a local calendar (date pickers, range pickers) for display.
 *
 * Unlike `formatDisplayDate*` the value is never moved into the configured timezone: a picked day
 * is a wall-clock choice, not an instant, and shifting it would show a different day than the one
 * clicked. A configured pattern renders through `date-fns` with the picker's locale; otherwise
 * `Intl` renders the locale's own style.
 */
export function formatLocalDisplayValue(value: Date, options: LocalDisplayValueOptions = {}): string | null {
  if (Number.isNaN(value.getTime())) return null
  const { withTime = false, locale, explicitFormat, settings = getActiveDateLocaleSettings() } = options
  const pattern = normalizeDateFormatPattern(explicitFormat) ?? (withTime ? settings.dateTimeFormat : settings.dateFormat)
  if (pattern) return formatWithPublicDateFormat(value, pattern, locale)
  const formatLocale = settings.locale ?? locale?.code
  // Same clock rule as `formatDisplay`: a pinned time pattern alone decides 12/24-hour, so a picker
  // shows the clock the tables and detail fields show.
  const hourCycle = withTime ? hourCycleOfPattern(settings.timeFormat) : undefined
  return formatWithFallbacks(value, withTime ? 'datetime' : 'date', [formatLocale, locale?.code], undefined, hourCycle)
}
