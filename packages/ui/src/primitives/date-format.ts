import { format as formatDateFns } from 'date-fns/format'
import { parseISO } from 'date-fns/parseISO'
import type { Locale } from 'date-fns/locale'

type LocaleLike = Locale | string | null | undefined

const DAY_FIRST_LOCALE_CODES = new Set([
  'pl', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'ru', 'cs', 'sk', 'hu', 'ro',
])

const SYSTEM_FORMAT_VALUES = new Set(['auto', 'default', 'locale', 'system'])

function getLocaleCode(locale?: LocaleLike): string {
  if (!locale) return ''
  if (typeof locale === 'string') return locale.split('-')[0]?.toLowerCase() ?? ''
  return locale.code?.split('-')[0]?.toLowerCase() ?? ''
}

export function normalizeDateFormatPattern(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  if (SYSTEM_FORMAT_VALUES.has(trimmed.toLowerCase())) return null
  return trimmed
    .replace(/YYYY/g, 'yyyy')
    .replace(/YY/g, 'yy')
    .replace(/DD/g, 'dd')
}

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
 * The pattern for a date rendered as static text next to a label — a detail field, a summary card.
 *
 * Deliberately NOT `resolvePublicDateFormat`: that one falls back to a locale-derived, month-name
 * pattern (`d MMM yyyy`) suited to a date picker's own display. Static values are dense and get
 * scanned in bulk, and they sit alongside `DataTable` cells, which resolve through
 * `resolveDisplayDateTimeFormat` — so both default to ISO and both honour the same env overrides.
 *
 * A date-only value reads only the date vars: there is no time to render, so a `…DATE_TIME_FORMAT`
 * pattern cannot apply. An app that sets only that var therefore still gets ISO here.
 */
export function resolveDisplayDateFormat(): string {
  return (
    normalizeDateFormatPattern(process.env.NEXT_PUBLIC_OM_DATE_FORMAT)
    ?? normalizeDateFormatPattern(process.env.NEXT_PUBLIC_DATE_FORMAT)
    ?? 'yyyy-MM-dd'
  )
}

/**
 * As `resolveDisplayDateFormat`, for a value that carries a real time of day. `DataTable` resolves
 * its cells through this, so a timestamp reads the same in a table and in a detail field.
 *
 * The date vars are in the chain, and used bare, because a caller that sets only a date pattern has
 * said how a date should look and said nothing about time — appending `HH:mm` would invent a
 * requirement. This is the precedence `resolvePublicDateTimeFormat` already uses.
 */
export function resolveDisplayDateTimeFormat(): string {
  return (
    normalizeDateFormatPattern(process.env.NEXT_PUBLIC_OM_DATE_TIME_FORMAT)
    ?? normalizeDateFormatPattern(process.env.NEXT_PUBLIC_DATE_TIME_FORMAT)
    ?? normalizeDateFormatPattern(process.env.NEXT_PUBLIC_OM_DATE_FORMAT)
    ?? normalizeDateFormatPattern(process.env.NEXT_PUBLIC_DATE_FORMAT)
    ?? `${resolveDisplayDateFormat()} HH:mm`
  )
}

/**
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

/** Render a date for display, or `null` when there is nothing valid to show. */
export function formatDisplayDate(value: string | Date | null | undefined, locale?: Locale): string | null {
  const parsed = parseDisplayValue(value)
  return parsed ? formatWithPublicDateFormat(parsed, resolveDisplayDateFormat(), locale) : null
}

/** Render a timestamp for display, or `null` when there is nothing valid to show. */
export function formatDisplayDateTime(value: string | Date | null | undefined, locale?: Locale): string | null {
  const parsed = parseDisplayValue(value)
  return parsed ? formatWithPublicDateFormat(parsed, resolveDisplayDateTimeFormat(), locale) : null
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
