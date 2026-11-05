/**
 * @jest-environment node
 */
import {
  resolveDateRange,
  getPreviousPeriod,
  isValidDateRangePreset,
  calculatePercentageChange,
  determineChangeDirection,
  DATE_RANGE_OPTIONS,
  type DateRangePreset,
} from '../dateRanges'

describe('dateRanges', () => {
  const referenceDate = new Date('2024-06-15T12:00:00.000Z')

  describe('resolveDateRange', () => {
    it('resolves "today" to start and end of current day', () => {
      const range = resolveDateRange('today', referenceDate)
      expect(range.start.getHours()).toBe(0)
      expect(range.start.getMinutes()).toBe(0)
      expect(range.end.getHours()).toBe(23)
      expect(range.end.getMinutes()).toBe(59)
    })

    it('resolves "yesterday" to start and end of previous day', () => {
      const range = resolveDateRange('yesterday', referenceDate)
      expect(range.start.getDate()).toBe(referenceDate.getDate() - 1)
      expect(range.start.getHours()).toBe(0)
      expect(range.end.getHours()).toBe(23)
    })

    it('resolves "this_week" to Monday through Sunday', () => {
      const range = resolveDateRange('this_week', referenceDate)
      expect(range.start.getDay()).toBe(1) // Monday
      expect(range.end.getDay()).toBe(0) // Sunday
    })

    it('resolves "last_week" to previous Monday through Sunday', () => {
      const range = resolveDateRange('last_week', referenceDate)
      expect(range.start.getDay()).toBe(1)
      expect(range.end.getDay()).toBe(0)
      expect(range.end.getTime()).toBeLessThan(referenceDate.getTime())
    })

    it('resolves "this_month" to first and last day of current month', () => {
      const range = resolveDateRange('this_month', referenceDate)
      expect(range.start.getDate()).toBe(1)
      expect(range.start.getMonth()).toBe(5) // June
      expect(range.end.getMonth()).toBe(5)
    })

    it('resolves "last_month" to first and last day of previous month', () => {
      const range = resolveDateRange('last_month', referenceDate)
      expect(range.start.getDate()).toBe(1)
      expect(range.start.getMonth()).toBe(4) // May
      expect(range.end.getMonth()).toBe(4)
      expect(range.end.getDate()).toBe(31) // May has 31 days
    })

    it('resolves "this_quarter" to Q2 for June date', () => {
      const range = resolveDateRange('this_quarter', referenceDate)
      expect(range.start.getMonth()).toBe(3) // April (Q2 start)
      expect(range.end.getMonth()).toBe(5) // June (Q2 end)
    })

    it('resolves "last_quarter" to Q1 for June date', () => {
      const range = resolveDateRange('last_quarter', referenceDate)
      expect(range.start.getMonth()).toBe(0) // January (Q1 start)
      expect(range.end.getMonth()).toBe(2) // March (Q1 end)
    })

    it('resolves "this_year" to full current year', () => {
      const range = resolveDateRange('this_year', referenceDate)
      expect(range.start.getMonth()).toBe(0)
      expect(range.start.getDate()).toBe(1)
      expect(range.end.getMonth()).toBe(11)
      expect(range.end.getDate()).toBe(31)
    })

    it('resolves "last_year" to full previous year', () => {
      const range = resolveDateRange('last_year', referenceDate)
      expect(range.start.getFullYear()).toBe(2023)
      expect(range.end.getFullYear()).toBe(2023)
    })

    it('resolves "last_7_days" to 7 day range ending today', () => {
      const range = resolveDateRange('last_7_days', referenceDate)
      expect(range.start.getHours()).toBe(0)
      expect(range.end.getHours()).toBe(23)
      expect(range.end.getMonth()).toBe(referenceDate.getMonth())
    })

    it('resolves "last_30_days" to 30 day range ending today', () => {
      const range = resolveDateRange('last_30_days', referenceDate)
      expect(range.start.getHours()).toBe(0)
      expect(range.end.getHours()).toBe(23)
      expect(range.end.getMonth()).toBe(referenceDate.getMonth())
    })

    it('resolves "last_90_days" to 90 day range ending today', () => {
      const range = resolveDateRange('last_90_days', referenceDate)
      expect(range.start.getHours()).toBe(0)
      expect(range.end.getHours()).toBe(23)
      // Start should be approximately 3 months back
      expect(range.start.getMonth()).toBeLessThan(referenceDate.getMonth())
    })

    it('defaults to this_month for unknown preset', () => {
      const range = resolveDateRange('unknown' as DateRangePreset, referenceDate)
      expect(range.start.getDate()).toBe(1)
      expect(range.start.getMonth()).toBe(5)
    })
  })

  describe('getPreviousPeriod', () => {
    it('returns previous day for today/yesterday presets', () => {
      const range = resolveDateRange('today', referenceDate)
      const previous = getPreviousPeriod(range, 'today')
      expect(previous.start.getDate()).toBe(range.start.getDate() - 1)
    })

    it('returns previous week for week presets', () => {
      const range = resolveDateRange('this_week', referenceDate)
      const previous = getPreviousPeriod(range, 'this_week')
      const daysDiff = Math.round((range.start.getTime() - previous.start.getTime()) / (1000 * 60 * 60 * 24))
      expect(daysDiff).toBe(7)
    })

    it('returns previous month for month presets', () => {
      const range = resolveDateRange('this_month', referenceDate)
      const previous = getPreviousPeriod(range, 'this_month')
      expect(previous.start.getMonth()).toBe(range.start.getMonth() - 1)
    })

    it('returns previous quarter for quarter presets', () => {
      const range = resolveDateRange('this_quarter', referenceDate)
      const previous = getPreviousPeriod(range, 'this_quarter')
      expect(previous.start.getMonth()).toBe(0) // Q1 start
    })

    it('returns previous year for year presets', () => {
      const range = resolveDateRange('this_year', referenceDate)
      const previous = getPreviousPeriod(range, 'this_year')
      expect(previous.start.getFullYear()).toBe(2023)
    })

    it('returns same duration offset for last_N_days presets', () => {
      const range = resolveDateRange('last_7_days', referenceDate)
      const previous = getPreviousPeriod(range, 'last_7_days')
      const currentDuration = range.end.getTime() - range.start.getTime()
      const previousDuration = previous.end.getTime() - previous.start.getTime()
      expect(currentDuration).toBe(previousDuration)
    })
  })

  describe('isValidDateRangePreset', () => {
    it('returns true for valid presets', () => {
      expect(isValidDateRangePreset('today')).toBe(true)
      expect(isValidDateRangePreset('yesterday')).toBe(true)
      expect(isValidDateRangePreset('this_month')).toBe(true)
      expect(isValidDateRangePreset('last_90_days')).toBe(true)
    })

    it('returns false for invalid presets', () => {
      expect(isValidDateRangePreset('invalid')).toBe(false)
      expect(isValidDateRangePreset('')).toBe(false)
      expect(isValidDateRangePreset(null)).toBe(false)
      expect(isValidDateRangePreset(undefined)).toBe(false)
      expect(isValidDateRangePreset(123)).toBe(false)
      expect(isValidDateRangePreset({})).toBe(false)
    })
  })

  describe('calculatePercentageChange', () => {
    it('calculates positive change correctly', () => {
      expect(calculatePercentageChange(150, 100)).toBe(50)
    })

    it('calculates negative change correctly', () => {
      expect(calculatePercentageChange(50, 100)).toBe(-50)
    })

    it('returns 0 when both values are 0', () => {
      expect(calculatePercentageChange(0, 0)).toBe(0)
    })

    it('returns 100 when previous is 0 and current is positive', () => {
      expect(calculatePercentageChange(100, 0)).toBe(100)
    })

    it('handles negative previous values', () => {
      expect(calculatePercentageChange(50, -100)).toBe(150)
    })
  })

  describe('determineChangeDirection', () => {
    it('returns "up" when current is greater', () => {
      expect(determineChangeDirection(150, 100)).toBe('up')
    })

    it('returns "down" when current is smaller', () => {
      expect(determineChangeDirection(50, 100)).toBe('down')
    })

    it('returns "unchanged" when values are equal', () => {
      expect(determineChangeDirection(100, 100)).toBe('unchanged')
    })
  })

  describe('DATE_RANGE_OPTIONS', () => {
    it('contains all 13 presets', () => {
      expect(DATE_RANGE_OPTIONS).toHaveLength(13)
    })

    it('each option has value and labelKey', () => {
      DATE_RANGE_OPTIONS.forEach((option) => {
        expect(option.value).toBeDefined()
        expect(option.labelKey).toBeDefined()
        expect(option.labelKey).toMatch(/^dashboards\.analytics\.dateRange\./)
      })
    })
  })
})
