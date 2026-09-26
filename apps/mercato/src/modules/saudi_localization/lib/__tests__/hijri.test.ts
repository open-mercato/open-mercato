import {
  DEFAULT_HIJRI_LOCALE,
  SAUDI_TIME_ZONE,
  formatDualCalendarDate,
  formatHijriDate,
  hijriLocaleTag,
  toHijriDateParts,
} from '../saudi/hijri'

const ARABIC_INDIC_DIGITS = /[\u0660-\u0669]/

// `ar-SA` inserts directional marks between date segments (U+200F) and renders
// digits in the Arabic-Indic system, so assertions compare the visible text.
const stripBidiMarks = (value: string) => value.replace(/[\u200e\u200f\u061c]/g, '')

// Umm al-Qura values as ICU resolves them for these instants (verified against
// the platform's ICU data, Riyadh zone unless a test says otherwise). Pinning
// instants rather than "today" keeps this honest across ICU revisions.
const NEW_YEAR_EVE = '2026-06-15T09:00:00Z' // 29 Dhu al-Hijjah 1447
const NEW_YEAR_DAY = '2026-06-16T09:00:00Z' // 1 Muharram 1448

describe('hijriLocaleTag', () => {
  it('pins the Umm al-Qura calendar on the requested base locale', () => {
    expect(hijriLocaleTag()).toBe('ar-SA-u-ca-islamic-umalqura')
    expect(hijriLocaleTag({ locale: 'en-SA' })).toBe('en-SA-u-ca-islamic-umalqura')
    expect(hijriLocaleTag({ latinDigits: true })).toBe('ar-SA-u-ca-islamic-umalqura-nu-latn')
  })

  it('drops an existing unicode extension so two calendars cannot stack', () => {
    expect(hijriLocaleTag({ locale: 'ar-SA-u-ca-gregory-nu-latn' })).toBe('ar-SA-u-ca-islamic-umalqura')
  })
})

describe('toHijriDateParts', () => {
  it('converts a Gregorian instant to its Hijri fields', () => {
    expect(toHijriDateParts('2026-01-31T09:15:00Z')).toEqual({ year: 1447, month: 8, day: 12 })
  })

  it('rolls the year over on 1 Muharram', () => {
    expect(toHijriDateParts(NEW_YEAR_EVE)).toEqual({ year: 1447, month: 12, day: 29 })
    expect(toHijriDateParts(NEW_YEAR_DAY)).toEqual({ year: 1448, month: 1, day: 1 })
  })

  it('computes the calendar day in the requested zone', () => {
    const instant = '2026-01-31T21:30:00Z'

    expect(toHijriDateParts(instant, { timeZone: 'UTC' })).toEqual({ year: 1447, month: 8, day: 12 })
    expect(toHijriDateParts(instant)).toEqual({ year: 1447, month: 8, day: 13 })
  })

  it('returns null instead of throwing on unusable input', () => {
    expect(toHijriDateParts(null)).toBeNull()
    expect(toHijriDateParts('')).toBeNull()
    expect(toHijriDateParts('not-a-date')).toBeNull()
    expect(toHijriDateParts(new Date(Number.NaN))).toBeNull()
  })
})

describe('formatHijriDate', () => {
  it('formats in the locale the caller asked for', () => {
    const formatted = formatHijriDate('2026-01-31T09:15:00Z') as string

    expect(formatted).not.toBeNull()
    expect(stripBidiMarks(formatted)).toContain('١٢/٠٨/١٤٤٧')
    expect(ARABIC_INDIC_DIGITS.test(formatted)).toBe(true)
    expect(SAUDI_TIME_ZONE).toBe('Asia/Riyadh')
    expect(DEFAULT_HIJRI_LOCALE).toBe('ar-SA')
  })

  it('can produce Latin digits', () => {
    const formatted = formatHijriDate('2026-01-31T09:15:00Z', { latinDigits: true }) as string

    expect(formatted).not.toBeNull()
    expect(ARABIC_INDIC_DIGITS.test(formatted)).toBe(false)
    expect(stripBidiMarks(formatted)).toContain('12/08/1447')
    expect(stripBidiMarks(formatted)).toContain('هـ')
  })

  it('returns null for unusable input', () => {
    expect(formatHijriDate('not-a-date')).toBeNull()
    expect(formatHijriDate(null)).toBeNull()
  })
})

describe('formatDualCalendarDate', () => {
  it('carries both calendars in the shape documents use', () => {
    const label = formatDualCalendarDate('2026-01-31T09:15:00Z', { latinDigits: true })

    expect(stripBidiMarks(label as string)).toMatch(/^31\/01\/2026 \(12\/08\/1447/)
  })

  it('keeps the Gregorian half in the same locale and numbering system as the Hijri half', () => {
    const arabicLabel = formatDualCalendarDate('2026-01-31T09:15:00Z') as string
    const latinLabel = formatDualCalendarDate('2026-01-31T09:15:00Z', { latinDigits: true }) as string

    expect(stripBidiMarks(arabicLabel)).toBe(`٣١/٠١/٢٠٢٦ (١٢/٠٨/١٤٤٧ هـ)`)
    expect(ARABIC_INDIC_DIGITS.test(latinLabel)).toBe(false)
    expect(stripBidiMarks(latinLabel)).toBe('31/01/2026 (12/08/1447 هـ)')
  })

  it('returns null for unusable input', () => {
    expect(formatDualCalendarDate('nope')).toBeNull()
  })
})
