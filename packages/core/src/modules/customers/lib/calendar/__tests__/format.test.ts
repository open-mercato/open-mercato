import { formatDateLabel, formatDateRangeLabel, formatTimeRangeLabel } from '../format'

const JUN_15 = new Date(2026, 5, 15)
const JUN_21 = new Date(2026, 5, 21)
const JUN_28 = new Date(2026, 5, 28)
const AT_14 = new Date(2026, 5, 28, 14, 0)
const AT_15 = new Date(2026, 5, 28, 15, 0)

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
})
