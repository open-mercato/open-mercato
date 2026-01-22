process.env.TZ = 'UTC'

import { getMergedAvailabilityWindows, type AvailabilityRuleLike } from '../lib/availabilityMerge'
import { DefaultPlannerAvailabilityService } from '../services/plannerAvailabilityService'

function toIsoWindow(window: { start: Date; end: Date; ruleId?: string }) {
  return {
    start: window.start.toISOString(),
    end: window.end.toISOString(),
    ruleId: window.ruleId,
  }
}

describe('DefaultPlannerAvailabilityService', () => {
  it('delegates to getMergedAvailabilityWindows', () => {
    const range = {
      start: new Date('2024-01-01T00:00:00Z'),
      end: new Date('2024-01-03T00:00:00Z'),
    }
    const rules: AvailabilityRuleLike[] = [
      {
        id: 'availability',
        rrule: 'DTSTART:20240101T090000Z;DURATION:PT2H;FREQ=DAILY;COUNT=2',
        kind: 'availability',
      },
    ]

    const service = new DefaultPlannerAvailabilityService()
    const direct = getMergedAvailabilityWindows({ rules, range }).map(toIsoWindow)
    const viaService = service.getMergedAvailabilityWindows({ rules, range }).map(toIsoWindow)

    expect(viaService).toEqual(direct)
  })

  it('merges unavailability into availability windows', () => {
    const service = new DefaultPlannerAvailabilityService()
    const range = {
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

    const windows = service.getMergedAvailabilityWindows({ rules, range }).map(toIsoWindow)

    expect(windows).toEqual([
      { start: '2024-01-01T09:00:00.000Z', end: '2024-01-01T12:00:00.000Z', ruleId: 'availability' },
      { start: '2024-01-01T13:00:00.000Z', end: '2024-01-01T17:00:00.000Z', ruleId: 'availability' },
    ])
  })

  it('respects exdates and one-off overrides', () => {
    const service = new DefaultPlannerAvailabilityService()
    const range = {
      start: new Date('2024-01-02T00:00:00Z'),
      end: new Date('2024-01-04T00:00:00Z'),
    }
    const rules: AvailabilityRuleLike[] = [
      {
        id: 'availability',
        rrule: 'DTSTART:20240102T090000Z;DURATION:PT2H;FREQ=DAILY;COUNT=2',
        exdates: ['2024-01-03'],
        kind: 'availability',
      },
      {
        id: 'once',
        rrule: 'DTSTART:20240103T090000Z;DURATION:PT1H;FREQ=DAILY;COUNT=1',
        kind: 'availability',
      },
    ]

    const windows = service.getMergedAvailabilityWindows({ rules, range }).map(toIsoWindow)

    expect(windows).toEqual([
      { start: '2024-01-02T09:00:00.000Z', end: '2024-01-02T11:00:00.000Z', ruleId: 'availability' },
      { start: '2024-01-03T00:00:00.000Z', end: '2024-01-04T00:00:00.000Z', ruleId: undefined },
    ])
  })
})
