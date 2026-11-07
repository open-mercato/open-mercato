import {
  addDays,
  anniversary,
  endsOn,
  isAnchorDayValid,
  localToday,
  periodBounds,
  prorationFactor,
  type RecurrenceSchedule,
} from '../recurrence'

function anniversaries(schedule: RecurrenceSchedule, count: number): string[] {
  return Array.from({ length: count }, (_, index) => anniversary(schedule, index))
}

describe('anniversary', () => {
  it('steps weekly by seven days', () => {
    expect(anniversaries({ frequency: 'weekly', startsOn: '2026-12-24' }, 3)).toEqual([
      '2026-12-24',
      '2026-12-31',
      '2027-01-07',
    ])
  })

  it('clamps a monthly 31 Jan anchor to the last day of shorter months and returns to the 31st', () => {
    expect(anniversaries({ frequency: 'monthly', startsOn: '2027-01-31' }, 4)).toEqual([
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
      '2027-04-30',
    ])
  })

  it('clamps a monthly 31 Jan anchor to 29 Feb in a leap year', () => {
    expect(anniversary({ frequency: 'monthly', startsOn: '2028-01-31' }, 1)).toBe('2028-02-29')
  })

  it('clamps a quarterly 31 Aug anchor to 30 Nov and keeps the 31st afterwards', () => {
    expect(anniversaries({ frequency: 'quarterly', startsOn: '2026-08-31' }, 4)).toEqual([
      '2026-08-31',
      '2026-11-30',
      '2027-02-28',
      '2027-05-31',
    ])
  })

  it('falls back from 29 Feb to 28 Feb in common years', () => {
    expect(anniversaries({ frequency: 'yearly', startsOn: '2028-02-29' }, 5)).toEqual([
      '2028-02-29',
      '2029-02-28',
      '2030-02-28',
      '2031-02-28',
      '2032-02-29',
    ])
  })

  it('keeps an explicit anchor day 31 when the recurrence starts on 30 Apr', () => {
    expect(anniversaries({ frequency: 'monthly', startsOn: '2027-04-30', anchorDay: 31 }, 3)).toEqual([
      '2027-04-30',
      '2027-05-31',
      '2027-06-30',
    ])
  })

  it('rejects a negative or fractional period index', () => {
    expect(() => anniversary({ frequency: 'monthly', startsOn: '2027-01-01' }, -1)).toThrow()
    expect(() => anniversary({ frequency: 'monthly', startsOn: '2027-01-01' }, 1.5)).toThrow()
  })
})

describe('isAnchorDayValid', () => {
  it('accepts an anchor that clamps onto the start date', () => {
    expect(isAnchorDayValid({ frequency: 'monthly', startsOn: '2027-04-30', anchorDay: 31 })).toBe(true)
    expect(isAnchorDayValid({ frequency: 'monthly', startsOn: '2027-04-15', anchorDay: 15 })).toBe(true)
    expect(isAnchorDayValid({ frequency: 'monthly', startsOn: '2027-04-15' })).toBe(true)
  })

  it('rejects an anchor that does not match the start date', () => {
    expect(isAnchorDayValid({ frequency: 'monthly', startsOn: '2027-04-15', anchorDay: 31 })).toBe(false)
    expect(isAnchorDayValid({ frequency: 'monthly', startsOn: '2027-05-30', anchorDay: 31 })).toBe(false)
  })

  it('rejects an anchor day on a weekly recurrence', () => {
    expect(isAnchorDayValid({ frequency: 'weekly', startsOn: '2027-04-15', anchorDay: 15 })).toBe(false)
  })
})

describe('endsOn', () => {
  const monthly: RecurrenceSchedule = { frequency: 'monthly', startsOn: '2026-10-01' }

  it('closes a whole period', () => {
    expect(endsOn({ ...monthly, periodCount: 1 })).toBe('2026-10-31')
    expect(endsOn({ ...monthly, periodCount: 12 })).toBe('2027-09-30')
    expect(endsOn({ ...monthly, periodCount: 24 })).toBe('2028-09-30')
  })

  it('ends the day before the next clamped anniversary', () => {
    expect(endsOn({ frequency: 'monthly', startsOn: '2027-01-31', periodCount: 1 })).toBe('2027-02-27')
  })

  it('is null for an open-ended recurrence', () => {
    expect(endsOn(monthly)).toBeNull()
    expect(endsOn({ ...monthly, periodCount: null })).toBeNull()
  })
})

describe('periodBounds', () => {
  it('runs from the anniversary to the day before the next one', () => {
    expect(periodBounds({ frequency: 'monthly', startsOn: '2027-01-31' }, 1)).toEqual({
      start: '2027-02-28',
      end: '2027-03-30',
    })
    expect(periodBounds({ frequency: 'weekly', startsOn: '2026-12-28' }, 0)).toEqual({
      start: '2026-12-28',
      end: '2027-01-03',
    })
  })
})

describe('prorationFactor', () => {
  const december = { start: '2026-12-01', end: '2026-12-31' }

  it('is days used over days in the period, to 4 decimals', () => {
    expect(prorationFactor('2026-12-17', december)).toBe('0.5161')
    expect(prorationFactor('2026-12-11', december)).toBe('0.3226')
  })

  it('is 0 at the period start and 1 the day after the period ends', () => {
    expect(prorationFactor('2026-12-01', december)).toBe('0.0000')
    expect(prorationFactor('2027-01-01', december)).toBe('1.0000')
  })

  it('clamps dates outside the period', () => {
    expect(prorationFactor('2026-11-15', december)).toBe('0.0000')
    expect(prorationFactor('2027-02-01', december)).toBe('1.0000')
  })

  it('rounds half up', () => {
    expect(prorationFactor('2027-01-02', { start: '2027-01-01', end: '2027-01-08' })).toBe('0.1250')
    expect(prorationFactor('2027-01-02', { start: '2027-01-01', end: '2027-03-21' })).toBe('0.0125')
  })
})

describe('date helpers', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29')
  })

  it('reads the local calendar date, not the UTC one', () => {
    expect(localToday(new Date(2026, 9, 26, 23, 30))).toBe('2026-10-26')
    expect(localToday(new Date(2026, 9, 27, 0, 15))).toBe('2026-10-27')
  })
})
