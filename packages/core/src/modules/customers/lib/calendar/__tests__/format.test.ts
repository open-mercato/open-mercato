import { formatDateLabel, formatDateRangeLabel, formatTimeLabel, formatTimeRangeLabel } from '../format'

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
