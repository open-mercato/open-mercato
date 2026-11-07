import {
  addUtcDays,
  getFirstDayOfMonthUtc,
  getFirstDayOfNextMonthUtc,
  getLastNWeekStarts,
  resolveMyWorkPeriods,
  getMondayUtc,
  toDateOnlyString,
} from '../dateBuckets'

describe('getMondayUtc', () => {
  it('returns the same Monday when given a Monday', () => {
    const monday = new Date(Date.UTC(2026, 3, 20))
    expect(getMondayUtc(monday).toISOString()).toBe('2026-04-20T00:00:00.000Z')
  })

  it('returns previous Monday for a Sunday', () => {
    const sunday = new Date(Date.UTC(2026, 3, 19))
    expect(getMondayUtc(sunday).toISOString()).toBe('2026-04-13T00:00:00.000Z')
  })

  it('returns Monday of the same ISO week for Wednesday', () => {
    const wednesday = new Date(Date.UTC(2026, 3, 22, 15, 30))
    expect(getMondayUtc(wednesday).toISOString()).toBe('2026-04-20T00:00:00.000Z')
  })
})

describe('getLastNWeekStarts', () => {
  it('returns N week starts oldest to newest ending on current week Monday', () => {
    const now = new Date(Date.UTC(2026, 3, 24))
    const starts = getLastNWeekStarts(7, now)
    expect(starts).toHaveLength(7)
    expect(starts[6].toISOString()).toBe('2026-04-20T00:00:00.000Z')
    expect(starts[0].toISOString()).toBe('2026-03-09T00:00:00.000Z')
  })

  it('handles year boundary (2026 → 2027)', () => {
    const now = new Date(Date.UTC(2027, 0, 4))
    const starts = getLastNWeekStarts(3, now)
    expect(starts.map((d) => d.toISOString())).toEqual([
      '2026-12-21T00:00:00.000Z',
      '2026-12-28T00:00:00.000Z',
      '2027-01-04T00:00:00.000Z',
    ])
  })
})

describe('month boundaries', () => {
  it('getFirstDayOfMonthUtc returns day 1 of the month', () => {
    const d = new Date(Date.UTC(2026, 3, 24))
    expect(getFirstDayOfMonthUtc(d).toISOString()).toBe('2026-04-01T00:00:00.000Z')
  })

  it('getFirstDayOfNextMonthUtc crosses year boundary', () => {
    const d = new Date(Date.UTC(2026, 11, 15))
    expect(getFirstDayOfNextMonthUtc(d).toISOString()).toBe('2027-01-01T00:00:00.000Z')
  })
})

describe('addUtcDays', () => {
  it('adds positive days', () => {
    const d = new Date(Date.UTC(2026, 3, 24))
    expect(addUtcDays(d, 5).toISOString()).toBe('2026-04-29T00:00:00.000Z')
  })

  it('subtracts when given negative', () => {
    const d = new Date(Date.UTC(2026, 3, 24))
    expect(addUtcDays(d, -7).toISOString()).toBe('2026-04-17T00:00:00.000Z')
  })
})

describe('toDateOnlyString', () => {
  it('formats as YYYY-MM-DD with zero padding', () => {
    const d = new Date(Date.UTC(2026, 0, 5))
    expect(toDateOnlyString(d)).toBe('2026-01-05')
  })
})

describe('resolveMyWorkPeriods', () => {
  // Sunday 2026-06-14 23:30 UTC is already Monday 2026-06-15 in Warsaw and still Sunday in New York.
  const nearMidnight = new Date('2026-06-14T23:30:00.000Z')

  it('names today and its week in the viewer zone', () => {
    const periods = resolveMyWorkPeriods(nearMidnight, 'Europe/Warsaw')
    expect(periods.todayDate).toBe('2026-06-15')
    expect(periods.weekStart.toISOString()).toBe('2026-06-15T00:00:00.000Z')
    expect(periods.weekEnd.toISOString()).toBe('2026-06-21T00:00:00.000Z')
  })

  it('keeps the previous week for a zone still on Sunday', () => {
    const periods = resolveMyWorkPeriods(nearMidnight, 'America/New_York')
    expect(periods.todayDate).toBe('2026-06-14')
    expect(periods.weekStart.toISOString()).toBe('2026-06-08T00:00:00.000Z')
  })

  it('uses the UTC day when no zone is configured', () => {
    const periods = resolveMyWorkPeriods(nearMidnight, null)
    expect(periods.todayDate).toBe('2026-06-14')
  })

  it('rolls the month at the zone midnight', () => {
    const periods = resolveMyWorkPeriods(new Date('2026-06-30T22:30:00.000Z'), 'Europe/Warsaw')
    expect(periods.todayDate).toBe('2026-07-01')
    expect(periods.monthStart.toISOString()).toBe('2026-07-01T00:00:00.000Z')
    expect(periods.nextMonthStart.toISOString()).toBe('2026-08-01T00:00:00.000Z')
  })
})
