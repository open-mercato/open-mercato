import type { ResolvedDateLocaleSettings } from '@open-mercato/shared/lib/date-locale/types'

/**
 * The quote email's "valid until" date: a long date in the tenant's formatting locale (else the
 * request locale) and display time zone (else the server zone), so a recipient near midnight sees
 * the day the tenant means.
 */
export function formatQuoteValidUntil(
  validUntil: Date,
  requestLocale: string,
  settings: Pick<ResolvedDateLocaleSettings, 'locale' | 'timeZone'>,
): string {
  return validUntil.toLocaleDateString(settings.locale ?? requestLocale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    ...(settings.timeZone ? { timeZone: settings.timeZone } : {}),
  })
}
