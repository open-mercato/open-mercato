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
 * scanned in bulk, and they sit alongside `DataTable` cells, which already default to ISO. The two
 * must agree, so this chain ends at ISO. Both honour the same env overrides.
 */
export function resolveDisplayDateFormat(): string {
  return (
    normalizeDateFormatPattern(process.env.NEXT_PUBLIC_OM_DATE_FORMAT)
    ?? normalizeDateFormatPattern(process.env.NEXT_PUBLIC_DATE_FORMAT)
    ?? 'yyyy-MM-dd'
  )
}

/** As `resolveDisplayDateFormat`, for a value that carries a real time of day. */
export function resolveDisplayDateTimeFormat(): string {
  return (
    normalizeDateFormatPattern(process.env.NEXT_PUBLIC_OM_DATE_TIME_FORMAT)
    ?? normalizeDateFormatPattern(process.env.NEXT_PUBLIC_DATE_TIME_FORMAT)
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
  if (value == null || value === '') return null
  const parsed = value instanceof Date ? value : parseISO(value)
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
