import { DefaultPlannerAvailabilityService } from '@open-mercato/core/modules/planner/services/plannerAvailabilityService'
import { buildStaffAvailabilityWindows, mergeStaffAvailabilityWindows } from '../availabilityWindows'

const planner = new DefaultPlannerAvailabilityService()
const utc = (value: string) => new Date(value)
const build = (input: Partial<Parameters<typeof buildStaffAvailabilityWindows>[0]> = {}) => mergeStaffAvailabilityWindows(
  buildStaffAvailabilityWindows({
    planner,
    range: { start: utc('2026-03-08T00:00:00Z'), end: utc('2026-03-10T00:00:00Z') },
    ruleSetRules: null,
    memberRules: [],
    leaveRequests: [],
    canReadPlannerReasons: false,
    canReadLeaveReasons: false,
    ...input,
  }),
)

describe('staff availability windows', () => {
  it('returns no outside-hours block without a rule set', () => {
    expect(build()).toEqual([])
  })

  it('uses the assigned weekly template and subtracts its availability from the requested range', () => {
    const range = { start: utc('2026-03-09T00:00:00Z'), end: utc('2026-03-10T00:00:00Z') }
    const ruleSetRules = [{
      id: 'monday-rule',
      kind: 'availability' as const,
      timezone: 'America/New_York',
      rrule: 'DTSTART:20260316T130000Z\nDURATION:PT8H\nRRULE:FREQ=WEEKLY',
      exdates: [],
    }]
    expect(build({ range, ruleSetRules })).toEqual([
      { kind: 'unavailable', start: '2026-03-09T00:00:00.000Z', end: '2026-03-09T13:00:00.000Z' },
      { kind: 'unavailable', start: '2026-03-09T21:00:00.000Z', end: '2026-03-10T00:00:00.000Z' },
    ])
  })

  it('uses a member working-hours override when present on an assigned schedule', () => {
    const range = { start: utc('2026-03-09T09:00:00Z'), end: utc('2026-03-09T17:00:00Z') }
    const ruleSetRules = [{
      id: 'template-monday',
      kind: 'availability' as const,
      timezone: 'UTC',
      rrule: 'DTSTART:20260309T090000Z\nDURATION:PT8H\nRRULE:FREQ=WEEKLY',
      exdates: [],
    }]
    const memberRules = [{
      ...ruleSetRules[0],
      id: 'member-monday',
      rrule: 'DTSTART:20260309T110000Z\nDURATION:PT4H\nRRULE:FREQ=WEEKLY',
    }]
    expect(build({ range, ruleSetRules, memberRules })).toEqual([
      { kind: 'unavailable', start: '2026-03-09T09:00:00.000Z', end: '2026-03-09T11:00:00.000Z' },
      { kind: 'unavailable', start: '2026-03-09T15:00:00.000Z', end: '2026-03-09T17:00:00.000Z' },
    ])
  })

  it.each([
    ['2026-03-08', '2026-03-08T05:00:00.000Z', '2026-03-09T04:00:00.000Z'],
    ['2026-11-01', '2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z'],
  ])('projects approved leave across DST and removes its UTC-anchored Planner mirror for %s', (date, start, end) => {
    const range = { start: utc(date), end: new Date(utc(date).getTime() + 48 * 60 * 60 * 1000) }
    const timezone = 'America/New_York'
    const reason = 'Leave category'
    const day = utc(date)
    const leaveRequests = [{ startDate: day, endDate: day, timezone, status: 'approved' as const, unavailabilityReasonValue: reason }]
    const memberRules = [{
      id: 'mirror',
      kind: 'unavailability' as const,
      timezone,
      rrule: `DTSTART:${date.replaceAll('-', '')}T000000Z\nDURATION:PT24H\nRRULE:FREQ=DAILY;COUNT=1`,
      exdates: [],
      unavailabilityReasonValue: reason,
    }]
    expect(build({ range, leaveRequests, memberRules, canReadPlannerReasons: true })).toEqual([{ kind: 'leave', start, end }])
    expect(build({ range, leaveRequests, memberRules, canReadLeaveReasons: true })).toEqual([{ kind: 'leave', start, end, reason }])
  })

  it('merges same-kind adjacent days, clips them and ignores rejected leave', () => {
    const from = '2026-03-08T12:00:00Z'
    const to = '2026-03-09T20:00:00Z'
    const leaveRequests = [
      { startDate: utc('2026-03-08'), endDate: utc('2026-03-08'), timezone: 'UTC', status: 'pending' as const },
      { startDate: utc('2026-03-09'), endDate: utc('2026-03-09'), timezone: 'UTC', status: 'pending' as const },
      { startDate: utc('2026-03-08'), endDate: utc('2026-03-09'), timezone: 'UTC', status: 'rejected' as const },
    ]
    expect(build({ range: { start: utc(from), end: utc(to) }, leaveRequests })).toEqual([
      { kind: 'tentative', start: utc(from).toISOString(), end: utc(to).toISOString() },
    ])
  })

  it('keeps a manual interval outside the part already covered by approved leave', () => {
    const timezone = 'UTC'
    const reason = 'Offsite'
    const leaveRequests = [{
      startDate: utc('2026-03-09'), endDate: utc('2026-03-09'), timezone, status: 'approved' as const,
    }]
    const memberRules = [{
      id: 'manual-offsite',
      kind: 'unavailability' as const,
      timezone,
      rrule: 'DTSTART:20260308T220000Z\nDURATION:PT4H\nRRULE:FREQ=DAILY',
      exdates: [],
      unavailabilityReasonValue: reason,
    }]
    expect(build({ leaveRequests, memberRules, canReadPlannerReasons: true })).toEqual([
      { kind: 'unavailable', start: '2026-03-08T22:00:00.000Z', end: '2026-03-09T00:00:00.000Z', reason },
      { kind: 'leave', start: '2026-03-09T00:00:00.000Z', end: '2026-03-10T00:00:00.000Z' },
    ])
  })
})
