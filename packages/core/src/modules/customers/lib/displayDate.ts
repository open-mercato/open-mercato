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
