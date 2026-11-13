import { formatDisplayDate, toUtcDateInputValue } from '@open-mercato/ui/primitives/date-format'
import { getActiveDateLocaleSettings } from '@open-mercato/ui/primitives/date-locale-store'
import { resolveDisplayTimeZone } from '@open-mercato/ui/primitives/date-locale-settings'

/**
 * Render an instant with a bespoke `Intl` shape (weekday names, compact day labels, month
 * headers) that the shared `formatDisplay*` helpers do not cover, in the configured locale and
 * display timezone. Pass the real instant, never a `toLocalZonedDate` projection, or the zone
 * shift is applied twice.
 */
export function formatZonedDateParts(
  value: Date | string,
  options: Intl.DateTimeFormatOptions,
  locale?: string | null,
): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const settings = getActiveDateLocaleSettings()
  const timeZone = resolveDisplayTimeZone(settings)
  const formatLocale = settings.locale ?? locale ?? undefined
  try {
    return new Intl.DateTimeFormat(formatLocale, { ...options, timeZone }).format(date)
  } catch {
    return new Intl.DateTimeFormat(locale ?? undefined, options).format(date)
  }
}

/**
 * Render a date-only value stored as UTC midnight (a deal's expected close date, written from a
 * date input) as its own calendar day. Reading it as an instant would name the previous day in
 * every zone west of UTC.
 */
export function formatCalendarDay(value: string | null | undefined, locale?: string | null): string | null {
  const day = toUtcDateInputValue(value)
  return day ? formatDisplayDate(day, locale ?? undefined) : null
}

/** As `formatCalendarDay`, with a bespoke `Intl` shape (for example `{ month: 'short', day: '2-digit' }`). */
export function formatCalendarDayParts(
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions,
  locale?: string | null,
): string | null {
  const day = toUtcDateInputValue(value)
  if (!day) return null
  const date = new Date(`${day}T00:00:00.000Z`)
  const formatLocale = getActiveDateLocaleSettings().locale ?? locale ?? undefined
  try {
    return new Intl.DateTimeFormat(formatLocale, { ...options, timeZone: 'UTC' }).format(date)
  } catch {
    return new Intl.DateTimeFormat(locale ?? undefined, { ...options, timeZone: 'UTC' }).format(date)
  }
}
