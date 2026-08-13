/**
 * Formats an ISO date string into a localised display date.
 *
 * @param iso - ISO 8601 date string
 * @param locale - Required BCP 47 locale tag
 * @returns Date formatted according to the locale's natural convention
 */
export function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { timeZone: 'UTC' })
}
