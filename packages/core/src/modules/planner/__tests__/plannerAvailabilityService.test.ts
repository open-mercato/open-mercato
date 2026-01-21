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
})
