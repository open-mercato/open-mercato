import { formatWithPublicDateFormat } from '@open-mercato/ui/primitives/date-format'
import { getActiveDateLocaleSettings } from '@open-mercato/ui/primitives/date-locale-store'

const DATE_OPTIONS: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }

const TIME_OPTIONS: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }

const NON_CANONICAL_INTL_SPACING = /[\u00a0\u2007\u2009\u202f]/g

function normalizeIntlSpacing(value: string): string {
  return value.replace(NON_CANONICAL_INTL_SPACING, ' ')
}

// Calendar dates are wall-clock values laid out on the runtime calendar grid, so a configured
// pattern formats them as they are instead of moving them into the display timezone.
function formatWithPattern(pattern: string | null, date: Date): string | null {
  return pattern ? formatWithPublicDateFormat(date, pattern) : null
}

function resolveLocale(locale: string): string {
  return getActiveDateLocaleSettings().locale ?? locale
}

export function formatDateLabel(locale: string, date: Date): string {
  return (
    formatWithPattern(getActiveDateLocaleSettings().dateFormat, date)
    ?? new Intl.DateTimeFormat(resolveLocale(locale), DATE_OPTIONS).format(date)
  )
}

export function formatDateRangeLabel(locale: string, from: Date, to: Date): string {
  const pattern = getActiveDateLocaleSettings().dateFormat
  const fromLabel = formatWithPattern(pattern, from)
  const toLabel = formatWithPattern(pattern, to)
  if (fromLabel && toLabel) return `${fromLabel} – ${toLabel}`
  const formatter = new Intl.DateTimeFormat(resolveLocale(locale), DATE_OPTIONS)
  try {
    return normalizeIntlSpacing(formatter.formatRange(from, to))
  } catch {
    return normalizeIntlSpacing(`${formatter.format(from)} – ${formatter.format(to)}`)
  }
}

export function formatTimeLabel(locale: string, date: Date): string {
  return (
    formatWithPattern(getActiveDateLocaleSettings().timeFormat, date)
    ?? normalizeIntlSpacing(new Intl.DateTimeFormat(resolveLocale(locale), TIME_OPTIONS).format(date))
  )
}

export function formatTimeRangeLabel(locale: string, start: Date, end: Date): string {
  const pattern = getActiveDateLocaleSettings().timeFormat
  const startLabel = formatWithPattern(pattern, start)
  const endLabel = formatWithPattern(pattern, end)
  if (startLabel && endLabel) return `${startLabel} – ${endLabel}`
  const formatter = new Intl.DateTimeFormat(resolveLocale(locale), TIME_OPTIONS)
  try {
    return normalizeIntlSpacing(formatter.formatRange(start, end))
  } catch {
    return normalizeIntlSpacing(`${formatter.format(start)} – ${formatter.format(end)}`)
  }
}
