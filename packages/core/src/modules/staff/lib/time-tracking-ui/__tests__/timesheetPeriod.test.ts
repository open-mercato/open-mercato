// T5.1 — the period model behind screens 11 and 12.
//
// The test that matters most is the US-E1 one: switching the period kind must
// keep the date context. It is written as a property of the anchor rather than
// of a component, because the anchor is the whole reason the rule holds.

import {
  buildCalendarWeeks,
  countWorkingDays,
  eachDayIso,
  formatPeriodLabel,
  isoWeekNumber,
  isTimesheetPeriodKind,
  parseIsoDay,
  periodTargetMinutes,
  resolvePeriodRange,
  shiftPeriodAnchor,
  startOfWeekIso,
  toIsoDay,
  type TimesheetPeriodKind,
} from '../timesheetPeriod'

describe('resolvePeriodRange', () => {
  it.each<[TimesheetPeriodKind, string, string, string]>([
    ['week', '2026-07-20', '2026-07-20', '2026-07-26'],
    ['week', '2026-07-26', '2026-07-20', '2026-07-26'],
    ['month', '2026-07-20', '2026-07-01', '2026-07-31'],
    ['quarter', '2026-07-20', '2026-07-01', '2026-09-30'],
    ['year', '2026-07-20', '2026-01-01', '2026-12-31'],
  ])('%s around %s spans %s..%s', (kind, anchor, from, to) => {
    expect(resolvePeriodRange(kind, anchor)).toEqual({ from, to })
  })

  it('treats February in a leap year correctly', () => {
    expect(resolvePeriodRange('month', '2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
  })
})

describe('US-E1 — switching the period kind keeps the date context', () => {
  it('week → month stays in the month the week is in, not January', () => {
    const anchor = '2026-07-22'
    expect(resolvePeriodRange('week', anchor)).toEqual({ from: '2026-07-20', to: '2026-07-26' })
    // The anchor is untouched by the switch; only the range is re-derived.
    expect(resolvePeriodRange('month', anchor).from).toBe('2026-07-01')
    expect(resolvePeriodRange('quarter', anchor).from).toBe('2026-07-01')
    expect(resolvePeriodRange('year', anchor)).toEqual({ from: '2026-01-01', to: '2026-12-31' })
  })

  it('month → week → month is a round trip, not a drift to the first of the month', () => {
    const anchor = '2026-07-22'
    const weekRange = resolvePeriodRange('week', anchor)
    expect(weekRange.from <= anchor && anchor <= weekRange.to).toBe(true)
    expect(resolvePeriodRange('month', anchor)).toEqual(resolvePeriodRange('month', '2026-07-22'))
  })
})

describe('shiftPeriodAnchor', () => {
  it('moves a week by seven days', () => {
    expect(shiftPeriodAnchor('week', '2026-07-22', -1)).toBe('2026-07-15')
    expect(shiftPeriodAnchor('week', '2026-07-22', 1)).toBe('2026-07-29')
  })

  it('moves a month while clamping the day into the shorter target month', () => {
    expect(shiftPeriodAnchor('month', '2026-01-31', 1)).toBe('2026-02-28')
    // …and never skips a month, which a naive +1 month on the 31st would do.
    expect(resolvePeriodRange('month', shiftPeriodAnchor('month', '2026-01-31', 1)).from).toBe('2026-02-01')
  })

  it('moves a quarter by three months and a year by twelve', () => {
    expect(shiftPeriodAnchor('quarter', '2026-07-20', -1)).toBe('2026-04-20')
    expect(shiftPeriodAnchor('year', '2026-07-20', 1)).toBe('2027-07-20')
  })
})

describe('working days and targets', () => {
  it('counts Mon–Fri only', () => {
    expect(countWorkingDays({ from: '2026-07-20', to: '2026-07-26' })).toBe(5)
    expect(countWorkingDays({ from: '2026-07-25', to: '2026-07-26' })).toBe(0)
  })

  it('scales the target by working days and answers null without a daily target', () => {
    expect(periodTargetMinutes({ from: '2026-07-20', to: '2026-07-26' }, 8)).toBe(2400)
    expect(periodTargetMinutes({ from: '2026-07-20', to: '2026-07-26' }, null)).toBeNull()
    expect(periodTargetMinutes({ from: '2026-07-20', to: '2026-07-26' }, 0)).toBeNull()
  })
})

describe('calendar grid', () => {
  it('renders whole Monday-to-Sunday weeks with the neighbouring months marked out of period', () => {
    const weeks = buildCalendarWeeks('2026-07-15', '2026-07-20')
    expect(weeks[0]).toHaveLength(7)
    expect(weeks[0][0].date).toBe('2026-06-29')
    expect(weeks[0][0].inPeriod).toBe(false)
    expect(weeks[0][2].date).toBe('2026-07-01')
    expect(weeks[0][2].inPeriod).toBe(true)
    const flat = weeks.flat()
    expect(flat.filter((cell) => cell.inPeriod)).toHaveLength(31)
    expect(flat.find((cell) => cell.isToday)?.date).toBe('2026-07-20')
    expect(flat.filter((cell) => cell.isWeekend).every((cell) => [0, 6].includes(new Date(cell.date + 'T00:00:00').getDay()))).toBe(true)
  })
})

describe('helpers', () => {
  it('starts weeks on Monday', () => {
    expect(startOfWeekIso('2026-07-19')).toBe('2026-07-13')
    expect(startOfWeekIso('2026-07-20')).toBe('2026-07-20')
  })

  it('answers the ISO week number the mockup shows', () => {
    expect(isoWeekNumber('2026-07-13')).toBe(29)
  })

  it('rejects malformed and impossible days', () => {
    expect(parseIsoDay('nope')).toBeNull()
    expect(parseIsoDay('2026-02-30')).toBeNull()
    expect(toIsoDay(new Date(2026, 6, 5))).toBe('2026-07-05')
  })

  it('enumerates a range inclusively and answers empty for an inverted one', () => {
    expect(eachDayIso({ from: '2026-07-20', to: '2026-07-22' })).toEqual([
      '2026-07-20',
      '2026-07-21',
      '2026-07-22',
    ])
    expect(eachDayIso({ from: '2026-07-22', to: '2026-07-20' })).toEqual([])
  })

  it('labels a quarter and a year without a locale dependency', () => {
    expect(formatPeriodLabel('quarter', '2026-07-20')).toBe('Q3 2026')
    expect(formatPeriodLabel('year', '2026-07-20')).toBe('2026')
    expect(formatPeriodLabel('week', '2026-07-13', 'en-GB')).toContain('W29')
  })

  it('guards the period kind', () => {
    expect(isTimesheetPeriodKind('week')).toBe(true)
    expect(isTimesheetPeriodKind('fortnight')).toBe(false)
  })
})
