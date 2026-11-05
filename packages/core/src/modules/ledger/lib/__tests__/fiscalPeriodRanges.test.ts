// Unit tests for the "generate 12 months" ranges (PR #5663 review, point 3).
import { isFirstOfMonth, monthRanges } from '../fiscalPeriodRanges'

const day = (value: Date) => value.toISOString().slice(0, 10)

describe('monthRanges', () => {
  it('returns twelve consecutive calendar months', () => {
    const ranges = monthRanges(new Date('2027-01-01'))
    expect(ranges).toHaveLength(12)
    expect(day(ranges[0].startDate)).toBe('2027-01-01')
    expect(day(ranges[0].endDate)).toBe('2027-01-31')
    expect(day(ranges[11].startDate)).toBe('2027-12-01')
    expect(day(ranges[11].endDate)).toBe('2027-12-31')
  })

  it('leaves no gap and no overlap between neighbours', () => {
    const ranges = monthRanges(new Date('2026-07-01'))
    for (let i = 1; i < ranges.length; i += 1) {
      const nextDay = new Date(ranges[i - 1].endDate.getTime() + 24 * 3600 * 1000)
      expect(day(nextDay)).toBe(day(ranges[i].startDate))
    }
    expect(day(ranges[11].endDate)).toBe('2027-06-30')
  })

  it('handles February in a leap year and a year boundary', () => {
    expect(day(monthRanges(new Date('2028-02-01'))[0].endDate)).toBe('2028-02-29')
    expect(day(monthRanges(new Date('2026-11-01'))[2].startDate)).toBe('2027-01-01')
  })
})

describe('isFirstOfMonth', () => {
  it('accepts the first day and rejects any other', () => {
    expect(isFirstOfMonth(new Date('2027-03-01'))).toBe(true)
    expect(isFirstOfMonth(new Date('2027-03-02'))).toBe(false)
  })
})
