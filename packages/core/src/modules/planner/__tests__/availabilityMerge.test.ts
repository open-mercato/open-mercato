process.env.TZ = 'UTC'

import { getMergedAvailabilityWindows, type AvailabilityRange, type AvailabilityRuleLike } from '../lib/availabilityMerge'

function toIsoWindow(window: { start: Date; end: Date }) {
  return { start: window.start.toISOString(), end: window.end.toISOString() }
}

describe('getMergedAvailabilityWindows', () => {
  it('expands daily rules and respects exdates', () => {
    const range: AvailabilityRange = {
      start: new Date('2024-01-01T00:00:00Z'),
      end: new Date('2024-01-04T00:00:00Z'),
    }
    const rules: AvailabilityRuleLike[] = [
      {
        id: 'rule-1',
        rrule: 'DTSTART:20240101T090000Z;DURATION:PT2H;FREQ=DAILY;COUNT=3',
        exdates: ['2024-01-02'],
      },
    ]

    const windows = getMergedAvailabilityWindows({ rules, range }).map(toIsoWindow)

    expect(windows).toEqual([
      { start: '2024-01-01T09:00:00.000Z', end: '2024-01-01T11:00:00.000Z' },
      { start: '2024-01-03T09:00:00.000Z', end: '2024-01-03T11:00:00.000Z' },
    ])
  })

  it('subtracts unavailability windows from availability', () => {
    const range: AvailabilityRange = {
      start: new Date('2024-01-01T00:00:00Z'),
      end: new Date('2024-01-02T00:00:00Z'),
    }
    const rules: AvailabilityRuleLike[] = [
      {
        id: 'availability',
        rrule: 'DTSTART:20240101T090000Z;DURATION:PT8H;FREQ=DAILY',
        kind: 'availability',
      },
      {
        id: 'unavailability',
        rrule: 'DTSTART:20240101T120000Z;DURATION:PT1H;FREQ=DAILY',
        kind: 'unavailability',
      },
    ]

    const windows = getMergedAvailabilityWindows({ rules, range }).map(toIsoWindow)

    expect(windows).toEqual([
      { start: '2024-01-01T09:00:00.000Z', end: '2024-01-01T12:00:00.000Z' },
      { start: '2024-01-01T13:00:00.000Z', end: '2024-01-01T17:00:00.000Z' },
    ])
  })

  it('drops availability on days overridden by once unavailability rules', () => {
    const range: AvailabilityRange = {
      start: new Date('2024-01-02T00:00:00Z'),
      end: new Date('2024-01-03T00:00:00Z'),
    }
    const rules: AvailabilityRuleLike[] = [
      {
        id: 'availability',
        rrule: 'DTSTART:20240101T090000Z;DURATION:PT8H;FREQ=DAILY',
        kind: 'availability',
      },
      {
        id: 'override',
        rrule: 'DTSTART:20240102T090000Z;DURATION:PT1H;FREQ=DAILY;COUNT=1',
        kind: 'unavailability',
      },
    ]

    const windows = getMergedAvailabilityWindows({ rules, range })

    expect(windows).toEqual([])
  })

  it('creates a full-day window for once availability overrides', () => {
    const range: AvailabilityRange = {
      start: new Date('2024-01-02T00:00:00Z'),
      end: new Date('2024-01-03T00:00:00Z'),
    }
    const rules: AvailabilityRuleLike[] = [
      {
        id: 'override',
        rrule: 'DTSTART:20240102T090000Z;DURATION:PT1H;FREQ=DAILY;COUNT=1',
        kind: 'availability',
      },
    ]

    const windows = getMergedAvailabilityWindows({ rules, range }).map(toIsoWindow)

    expect(windows).toEqual([
      { start: '2024-01-02T00:00:00.000Z', end: '2024-01-03T00:00:00.000Z' },
    ])
  })

  it('uses weekly staff schedules before the next-occurrence DTSTART anchor only when requested', () => {
    const params = {
      respectTimezone: true,
      rules: [{ rrule: 'DTSTART:20261006T070000Z\nDURATION:PT4H\nRRULE:FREQ=WEEKLY;BYDAY=TU', timezone: 'Europe/Warsaw' }],
      range: { start: new Date('2026-09-29T07:15:00Z'), end: new Date('2026-09-29T10:00:00Z') },
    }
    expect(getMergedAvailabilityWindows(params)).toEqual([])
    expect(getMergedAvailabilityWindows({ ...params, weeklyScheduleTemplate: true }).map(toIsoWindow)).toEqual([
      { start: '2026-09-29T07:00:00.000Z', end: '2026-09-29T11:00:00.000Z' },
    ])
  })

  it('preserves dated one-off availability and count-bounded weekly starts in schedule-template mode', () => {
    const params = { respectTimezone: true, weeklyScheduleTemplate: true,
      range: { start: new Date('2026-09-29T07:15:00Z'), end: new Date('2026-09-29T10:00:00Z') },
    }
    expect(getMergedAvailabilityWindows({ ...params,
      rules: [{ rrule: 'DTSTART:20261006T070000Z;DURATION:PT4H;FREQ=DAILY;COUNT=1', timezone: 'Europe/Warsaw' }],
    })).toEqual([])
    expect(getMergedAvailabilityWindows({ ...params,
      rules: [{ rrule: 'DTSTART:20261006T070000Z;DURATION:PT4H;FREQ=WEEKLY;COUNT=2', timezone: 'Europe/Warsaw' }],
    })).toEqual([])
  })

  it('preserves UTC semantics for existing callers that supply a non-UTC timezone', () => {
    const windows = getMergedAvailabilityWindows({
      rules: [{ rrule: 'DTSTART:20260322T080000Z;DURATION:PT2H;FREQ=WEEKLY', timezone: 'Europe/Warsaw' }],
      range: { start: new Date('2026-03-29T06:00:00Z'), end: new Date('2026-03-29T11:00:00Z') },
    }).map(toIsoWindow)
    expect(windows).toEqual([{ start: '2026-03-29T08:00:00.000Z', end: '2026-03-29T10:00:00.000Z' }])
  })

  it('preserves UTC full-day overrides unless timezone handling is requested', () => {
    const windows = getMergedAvailabilityWindows({
      rules: [{ rrule: 'DTSTART:20260329T080000Z;DURATION:PT2H;FREQ=DAILY;COUNT=1', timezone: 'Europe/Warsaw' }],
      range: { start: new Date('2026-03-28T00:00:00Z'), end: new Date('2026-03-30T00:00:00Z') },
    }).map(toIsoWindow)
    expect(windows).toEqual([{ start: '2026-03-29T00:00:00.000Z', end: '2026-03-30T00:00:00.000Z' }])
  })

  it('skips decades of zoned recurrence before the requested range and reuses its formatter', () => {
    const formatted = jest.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts')
    try {
      const params = {
        respectTimezone: true,
        rules: [{ rrule: 'DTSTART:19000101T080000Z;DURATION:PT2H;FREQ=DAILY', timezone: 'Europe/Warsaw' }],
        range: { start: new Date('2026-03-29T00:00:00Z'), end: new Date('2026-03-30T00:00:00Z') },
      }
      const windows = getMergedAvailabilityWindows(params)
      expect(windows).toHaveLength(1)
      expect(formatted.mock.calls.length).toBeLessThan(30)
    } finally {
      formatted.mockRestore()
    }
  })

  it('does not revive an exhausted zoned recurrence count after skipping ahead', () => {
    expect(getMergedAvailabilityWindows({
      respectTimezone: true,
      rules: [{ rrule: 'DTSTART:20200101T080000Z;DURATION:PT2H;FREQ=WEEKLY;COUNT=4', timezone: 'Europe/Warsaw' }],
      range: { start: new Date('2026-03-29T00:00:00Z'), end: new Date('2026-03-30T00:00:00Z') },
    })).toEqual([])
  })

  it('includes occurrences that start before the range and overlap it', () => {
    expect(getMergedAvailabilityWindows({
      rules: [{ rrule: 'DTSTART:20261001T230000Z;DURATION:PT4H;FREQ=WEEKLY' }],
      range: { start: new Date('2026-10-09T01:00:00Z'), end: new Date('2026-10-09T02:00:00Z') },
    }).map(toIsoWindow)).toEqual([{ start: '2026-10-08T23:00:00.000Z', end: '2026-10-09T03:00:00.000Z' }])
  })

  it('keeps a weekly local start time when daylight saving begins', () => {
    const windows = getMergedAvailabilityWindows({
      respectTimezone: true,
      rules: [{
        rrule: 'DTSTART:20260322T080000Z\nDURATION:PT2H\nRRULE:FREQ=WEEKLY',
        timezone: 'Europe/Warsaw',
      }],
      range: { start: new Date('2026-03-29T06:00:00Z'), end: new Date('2026-03-29T10:00:00Z') },
    }).map(toIsoWindow)

    expect(windows).toEqual([{ start: '2026-03-29T07:00:00.000Z', end: '2026-03-29T09:00:00.000Z' }])
  })

  it('keeps a weekly local start time when daylight saving ends', () => {
    const windows = getMergedAvailabilityWindows({
      respectTimezone: true,
      rules: [{
        rrule: 'DTSTART:20261018T070000Z\nDURATION:PT2H\nRRULE:FREQ=WEEKLY',
        timezone: 'Europe/Warsaw',
      }],
      range: { start: new Date('2026-10-25T06:00:00Z'), end: new Date('2026-10-25T11:00:00Z') },
    }).map(toIsoWindow)

    expect(windows).toEqual([{ start: '2026-10-25T08:00:00.000Z', end: '2026-10-25T10:00:00.000Z' }])
  })
})
