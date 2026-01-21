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
})
