/**
 * Hijri (Umm al-Qura) dates for display and document output.
 *
 * Saudi documents are commonly dated in both calendars, and ICU ships the
 * `islamic-umalqura` calendar — the one the Kingdom observes — so this reads it
 * from `Intl` rather than carrying a conversion table that would drift from the
 * published calendar.
 *
 * Two rules these helpers exist to enforce:
 *
 *   - **Display only.** Machine-readable values (the ZATCA QR timestamp, stored
 *     timestamps) stay Gregorian ISO 8601. A Hijri string in a payload is simply
 *     invalid to ZATCA, so no helper here returns one for transport.
 *   - **A time zone is part of the answer.** `2026-01-31T21:30Z` is 12 Sha'ban in
 *     UTC and 13 Sha'ban in Riyadh, so the zone defaults to `Asia/Riyadh` and is
 *     explicit in every call rather than inherited from wherever the server runs.
 *
 * Invalid or missing input returns `null` instead of throwing: these run on
 * document rendering paths, where a blank date beats a crashed page.
 */

export const SAUDI_TIME_ZONE = 'Asia/Riyadh'
export const HIJRI_CALENDAR_ID = 'islamic-umalqura'
export const DEFAULT_HIJRI_LOCALE = 'ar-SA'

export type HijriDateParts = { year: number; month: number; day: number }

export type HijriFormatOptions = {
  /** Base locale for the digits and separators. Defaults to `ar-SA`. */
  locale?: string
  /** Force Latin digits instead of the Arabic-Indic ones `ar-SA` implies. */
  latinDigits?: boolean
  /** Zone the calendar day is computed in. Defaults to `Asia/Riyadh`. */
  timeZone?: string
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value !== 'string' || value.trim().length === 0) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * A locale tag with the Umm al-Qura calendar pinned, e.g.
 * `ar-SA-u-ca-islamic-umalqura-nu-latn`. An existing `-u-` extension on the base
 * locale is dropped first so a caller cannot silently end up with two calendars.
 */
export function hijriLocaleTag(options: HijriFormatOptions = {}): string {
  const base = (options.locale ?? DEFAULT_HIJRI_LOCALE).split('-u-')[0] || DEFAULT_HIJRI_LOCALE
  return `${base}-u-ca-${HIJRI_CALENDAR_ID}${options.latinDigits ? '-nu-latn' : ''}`
}

/** Numeric Hijri fields, for comparisons and for storing a document's date parts. */
export function toHijriDateParts(
  value: Date | string | null | undefined,
  options: HijriFormatOptions = {},
): HijriDateParts | null {
  const date = toDate(value)
  if (!date) return null

  const parts = new Intl.DateTimeFormat(hijriLocaleTag({ ...options, latinDigits: true }), {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    timeZone: options.timeZone ?? SAUDI_TIME_ZONE,
  }).formatToParts(date)

  const read = (type: 'day' | 'month' | 'year'): number | null => {
    const raw = parts.find((part) => part.type === type)?.value
    if (!raw) return null
    const parsed = Number(raw.replace(/[^0-9]/g, ''))
    return Number.isFinite(parsed) ? parsed : null
  }

  const year = read('year')
  const month = read('month')
  const day = read('day')
  if (year === null || month === null || day === null) return null
  return { year, month, day }
}

/** The Hijri date as it appears on a Saudi document, e.g. `١٢/٠٨/١٤٤٧ هـ`. */
export function formatHijriDate(
  value: Date | string | null | undefined,
  options: HijriFormatOptions = {},
): string | null {
  const date = toDate(value)
  if (!date) return null
  return new Intl.DateTimeFormat(hijriLocaleTag(options), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: options.timeZone ?? SAUDI_TIME_ZONE,
  }).format(date)
}

/**
 * Both calendars in one label, the shape Saudi documents use:
 * `31/01/2026 (١٢/٠٨/١٤٤٧ هـ)`. The Gregorian half follows the same base locale,
 * so Arabic output stays in Arabic everywhere on the page.
 */
export function formatDualCalendarDate(
  value: Date | string | null | undefined,
  options: HijriFormatOptions = {},
): string | null {
  const date = toDate(value)
  if (!date) return null

  const timeZone = options.timeZone ?? SAUDI_TIME_ZONE
  const baseLocale = (options.locale ?? DEFAULT_HIJRI_LOCALE).split('-u-')[0] || DEFAULT_HIJRI_LOCALE
  // `latinDigits` has to apply to the Gregorian half as well, or a caller asking
  // for readable digits gets one half in each numbering system.
  const gregorianLocale = options.latinDigits ? `${baseLocale}-u-nu-latn` : baseLocale
  const gregorian = new Intl.DateTimeFormat(gregorianLocale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone,
  }).format(date)
  const hijri = formatHijriDate(date, { ...options, timeZone })
  if (!hijri) return null
  return `${gregorian} (${hijri})`
}
