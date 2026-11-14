import { formatRecurrenceDate, formatRecurrenceSchedule } from '../recurrenceLabel'

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
