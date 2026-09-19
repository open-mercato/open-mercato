import { formatDateLabel, formatDateRangeLabel, formatTimeLabel, formatTimeRangeLabel } from '../format'
import { EU_DISPLAY_TEMPLATE, US_DISPLAY_TEMPLATE } from '@open-mercato/shared/lib/display/templates'

const JUN_15 = new Date(2026, 5, 15)
const JUN_21 = new Date(2026, 5, 21)
const JUN_28 = new Date(2026, 5, 28)
const JUL_27 = new Date(2026, 6, 27)
const AUG_2 = new Date(2026, 7, 2)
const AT_14 = new Date(2026, 5, 28, 14, 0)
const AT_15 = new Date(2026, 5, 28, 15, 0)

const HYDRATION_UNSTABLE_SPACING = /[\u00a0\u2007\u2009\u202f]/

describe('formatDateRangeLabel', () => {
  it('localizes the month name for Polish instead of falling back to English', () => {
    const label = formatDateRangeLabel('pl', JUN_15, JUN_21)
    expect(label).toContain('cze')
    expect(label).toContain('2026')
    expect(label).not.toMatch(/Jun/)
  })

  it('keeps English month names for the English locale', () => {
    expect(formatDateRangeLabel('en', JUN_15, JUN_21)).toContain('Jun')
  })

  it('produces a different label per locale', () => {
    expect(formatDateRangeLabel('pl', JUN_15, JUN_21)).not.toBe(
      formatDateRangeLabel('en', JUN_15, JUN_21),
    )
  })

  it('uses hydration-stable spacing around the localized range', () => {
    const label = formatDateRangeLabel('en', JUL_27, AUG_2)

    expect(label).toBe('Jul 27 – Aug 2, 2026')
    expect(label).not.toMatch(HYDRATION_UNSTABLE_SPACING)
  })
})

describe('formatDateLabel', () => {
  it('localizes a single date for Polish', () => {
    const label = formatDateLabel('pl', JUN_28)
    expect(label).toContain('28')
    expect(label).toContain('cze')
    expect(label).toContain('2026')
    expect(label).not.toMatch(/Jun/)
  })

  it('keeps English month names for the English locale', () => {
    expect(formatDateLabel('en', JUN_28)).toContain('Jun')
  })
})

describe('formatTimeLabel', () => {
  it('renders a 24h time for Polish without AM/PM markers', () => {
    expect(formatTimeLabel('pl', AT_14)).toBe('14:00')
  })

  it('uses the 12h clock for the English locale', () => {
    expect(formatTimeLabel('en', AT_14)).toBe('2:00 PM')
  })

  it('uses hydration-stable spacing inside the localized time', () => {
    expect(formatTimeLabel('en', AT_14)).not.toMatch(HYDRATION_UNSTABLE_SPACING)
  })

  it('formats each endpoint the same way the range formatter does', () => {
    for (const locale of ['en', 'pl', 'de']) {
      const range = formatTimeRangeLabel(locale, AT_14, AT_15)
      expect(range).toContain(formatTimeLabel(locale, AT_15))
    }
  })
})

describe('formatTimeRangeLabel', () => {
  it('renders a 24h range for Polish without AM/PM markers', () => {
    const label = formatTimeRangeLabel('pl', AT_14, AT_15)
    expect(label).toContain('14:00')
    expect(label).toContain('15:00')
    expect(label).not.toMatch(/AM|PM/i)
  })

  it('uses the 12h clock for the English locale', () => {
    expect(formatTimeRangeLabel('en', AT_14, AT_15)).toMatch(/PM/)
  })

  it('produces a different label per locale', () => {
    expect(formatTimeRangeLabel('pl', AT_14, AT_15)).not.toBe(
      formatTimeRangeLabel('en', AT_14, AT_15),
    )
  })

  it('uses hydration-stable spacing around the localized range', () => {
    const label = formatTimeRangeLabel('en', AT_14, AT_15)

    expect(label).toBe('2:00 – 3:00 PM')
    expect(label).not.toMatch(HYDRATION_UNSTABLE_SPACING)
  })
})

describe('market display profile', () => {
  // The runner is pinned to America/New_York, so `AT_14` is the instant 2026-06-28T18:00Z: 1:00 PM
  // in Chicago and 20:00 in Warsaw. Asserting the shifted value is the point - the market decides
  // the zone as well as the clock, and a conflict list that ignored the zone would name the wrong
  // hour.
  it('renders a 12-hour clock in the market zone even under a Polish UI locale', () => {
    expect(formatTimeLabel('pl', AT_14, US_DISPLAY_TEMPLATE)).toBe('1:00 PM')
    expect(formatTimeRangeLabel('pl', AT_14, AT_15, US_DISPLAY_TEMPLATE)).toMatch(/PM/)
  })

  it('keeps the 24-hour clock for the EU market', () => {
    expect(formatTimeLabel('en', AT_14, EU_DISPLAY_TEMPLATE)).toBe('20:00')
  })

  it('leaves the hour cycle to the UI locale when no market is picked', () => {
    expect(formatTimeLabel('pl', AT_14)).toBe('14:00')
    expect(formatTimeLabel('en', AT_14)).toBe('2:00 PM')
  })

  it('never emits a hydration-unstable space', () => {
    expect(formatTimeLabel('pl', AT_15, US_DISPLAY_TEMPLATE)).not.toMatch(HYDRATION_UNSTABLE_SPACING)
    expect(formatTimeRangeLabel('pl', AT_14, AT_15, US_DISPLAY_TEMPLATE)).not.toMatch(HYDRATION_UNSTABLE_SPACING)
  })

  it('names the month in the market language on a date label', () => {
    expect(formatDateLabel('pl', JUN_28, US_DISPLAY_TEMPLATE)).toContain('Jun')
    expect(formatDateRangeLabel('pl', JUN_15, JUN_21, US_DISPLAY_TEMPLATE)).toContain('Jun')
  })
})
