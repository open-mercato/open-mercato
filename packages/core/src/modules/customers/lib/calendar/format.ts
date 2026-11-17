import { TZDate } from '@date-fns/tz'
import type { ResolvedDateLocaleSettings } from '@open-mercato/shared/lib/date-locale/types'
import { resolveDateFnsLocale } from '@open-mercato/ui/primitives/date-fns-locales'
import { formatWithPublicDateFormat } from '@open-mercato/ui/primitives/date-format'
import { getActiveDateLocaleSettings } from '@open-mercato/ui/primitives/date-locale-store'

export type CalendarFormatSettings = Pick<ResolvedDateLocaleSettings, 'locale' | 'dateFormat' | 'timeFormat'> & Partial<Pick<ResolvedDateLocaleSettings, 'timeZone'>>

const DATE_OPTIONS: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }

const TIME_OPTIONS: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }

const NON_CANONICAL_INTL_SPACING = /[\u00a0\u2007\u2009\u202f]/g

function normalizeIntlSpacing(value: string): string {
  return value.replace(NON_CANONICAL_INTL_SPACING, ' ')
}

function formatWithPattern(pattern: string | null, date: Date, locale: string, timeZone?: string | null): string | null {
  return pattern ? formatWithPublicDateFormat(timeZone ? new TZDate(date.getTime(), timeZone) : date, pattern, resolveDateFnsLocale(locale)) : null
}

function resolveLocale(locale: string, settings: CalendarFormatSettings): string {
  return settings.locale ?? locale
}

export function formatDateLabel(
  locale: string,
  date: Date,
  settings: CalendarFormatSettings = getActiveDateLocaleSettings(),
): string {
  const formatLocale = resolveLocale(locale, settings)
  return (
    formatWithPattern(settings.dateFormat, date, formatLocale, settings.timeZone)
    ?? new Intl.DateTimeFormat(formatLocale, { ...DATE_OPTIONS, timeZone: settings.timeZone ?? undefined }).format(date)
  )
}

export function formatDateRangeLabel(
  locale: string,
  from: Date,
  to: Date,
  settings: CalendarFormatSettings = getActiveDateLocaleSettings(),
): string {
  const formatLocale = resolveLocale(locale, settings)
  const fromLabel = formatWithPattern(settings.dateFormat, from, formatLocale, settings.timeZone)
  const toLabel = formatWithPattern(settings.dateFormat, to, formatLocale, settings.timeZone)
  if (fromLabel && toLabel) return `${fromLabel} – ${toLabel}`
  const formatter = new Intl.DateTimeFormat(formatLocale, { ...DATE_OPTIONS, timeZone: settings.timeZone ?? undefined })
  try {
    return normalizeIntlSpacing(formatter.formatRange(from, to))
  } catch {
    return normalizeIntlSpacing(`${formatter.format(from)} – ${formatter.format(to)}`)
  }
}

export function formatTimeLabel(
  locale: string,
  date: Date,
  settings: CalendarFormatSettings = getActiveDateLocaleSettings(),
): string {
  const formatLocale = resolveLocale(locale, settings)
  return (
    formatWithPattern(settings.timeFormat, date, formatLocale, settings.timeZone)
    ?? normalizeIntlSpacing(new Intl.DateTimeFormat(formatLocale, { ...TIME_OPTIONS, timeZone: settings.timeZone ?? undefined }).format(date))
  )
}

export function formatTimeRangeLabel(
  locale: string,
  start: Date,
  end: Date,
  settings: CalendarFormatSettings = getActiveDateLocaleSettings(),
): string {
  const formatLocale = resolveLocale(locale, settings)
  const startLabel = formatWithPattern(settings.timeFormat, start, formatLocale, settings.timeZone)
  const endLabel = formatWithPattern(settings.timeFormat, end, formatLocale, settings.timeZone)
  if (startLabel && endLabel) return `${startLabel} – ${endLabel}`
  const formatter = new Intl.DateTimeFormat(formatLocale, { ...TIME_OPTIONS, timeZone: settings.timeZone ?? undefined })
  try {
    return normalizeIntlSpacing(formatter.formatRange(start, end))
  } catch {
    return normalizeIntlSpacing(`${formatter.format(start)} – ${formatter.format(end)}`)
  }
}
