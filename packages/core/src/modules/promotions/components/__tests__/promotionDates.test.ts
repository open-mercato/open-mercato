import { formatPromotionCalendarDate, promotionCalendarDate } from '../promotionDates'

describe('promotion calendar dates', () => {
  it('keeps the API calendar date for an end-of-day timestamp', () => {
    expect(promotionCalendarDate('2026-10-31T23:59:59.999Z')).toBe('2026-10-31')
  })

  it('formats the stored calendar date without shifting it through the browser timezone', () => {
    expect(formatPromotionCalendarDate('2026-10-31T23:59:59.999Z', 'pl-PL')).toBe('31.10.2026')
    expect(formatPromotionCalendarDate('2026-10-31T23:59:59.999Z', 'en-US')).toBe('10/31/2026')
  })

  it('returns null for invalid dates', () => {
    expect(promotionCalendarDate('2026-02-31T23:59:59.999Z')).toBeNull()
    expect(formatPromotionCalendarDate('not-a-date')).toBeNull()
  })
})
