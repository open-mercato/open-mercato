import { formatRecurrenceConflictValue, formatRecurrenceDate, formatRecurrenceSchedule, formatRecurringTotalLabel } from '../recurrenceLabel'

function translate(_key: string, fallback?: string, params?: Record<string, string | number>): string {
  return (fallback ?? _key).replace(/\{(\w+)\}/g, (match, name) => (params && name in params ? String(params[name]) : match))
}

describe('formatRecurrenceSchedule', () => {
  it('describes a finite schedule with its payment count', () => {
    expect(formatRecurrenceSchedule({ frequency: 'monthly', startsOn: '2026-10-01', periodCount: 24 }, translate, 'en-GB')).toBe(
      'Monthly from 1 Oct 2026, 24 payments',
    )
  })

  it('uses the singular for one payment', () => {
    expect(formatRecurrenceSchedule({ frequency: 'yearly', startsOn: '2027-02-28', periodCount: 1 }, translate, 'en-GB')).toBe(
      'Yearly from 28 Feb 2027, 1 payment',
    )
  })

  it('describes an open-ended schedule', () => {
    expect(formatRecurrenceSchedule({ frequency: 'weekly', startsOn: '2026-12-31', periodCount: null }, translate, 'en-GB')).toBe(
      'Weekly from 31 Dec 2026, no end date',
    )
  })
})

describe('formatRecurrenceDate', () => {
  it('keeps the calendar day regardless of the viewer timezone', () => {
    expect(formatRecurrenceDate('2026-01-01', 'en-GB')).toBe('1 Jan 2026')
  })

  it('returns an empty string for a missing date and the raw value for an invalid one', () => {
    expect(formatRecurrenceDate(null)).toBe('')
    expect(formatRecurrenceDate('not-a-date')).toBe('not-a-date')
  })
})

describe('formatRecurringTotalLabel', () => {
  it.each([
    ['weekly', 'week'], ['monthly', 'month'], ['quarterly', 'quarter'], ['yearly', 'year'],
  ] as const)('labels a %s total with its billing interval', (frequency, interval) => {
    expect(formatRecurringTotalLabel('Total', frequency, translate)).toBe(`Total (per ${interval})`)
  })

  it('leaves one-time totals alone', () => {
    expect(formatRecurringTotalLabel('Total', undefined, translate)).toBe('Total')
  })
})

describe('formatRecurrenceConflictValue', () => {
  it('shows the explicit billing day when the start is clamped to month end', () => {
    expect(formatRecurrenceConflictValue({
      frequency: 'monthly', startsOn: '2027-04-30', anchorDay: 31, periodCount: 3,
    }, translate, 'en-GB')).toBe('Monthly from 30 Apr 2027, 3 payments (billing day: 31)')
  })

  it('leaves an absent schedule to the default conflict display', () => {
    expect(formatRecurrenceConflictValue(null, translate)).toBeNull()
  })
})
