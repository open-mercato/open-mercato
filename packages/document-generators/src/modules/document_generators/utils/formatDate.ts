/**
 * Formats an ISO date string into a localised display date.
 *
 * @param iso - ISO 8601 date string
 * @param locale - Required BCP 47 locale tag
 * @returns Formatted date string, e.g. "09.05.2026"
 */
export function formatDate(iso: string, locale: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
}
