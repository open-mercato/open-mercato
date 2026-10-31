// #6934 — a contributed EP-40 capacity provider drives the timesheet target,
// the load scale, the per-day deviation and the default expanded day.

import {
  buildTimesheetDays,
  pickDefaultExpandedDay,
  resolveDayScaleMinutes,
  resolveDayTargetMinutes,
  resolveLoadScaleMinutes,
  summarizeTimesheet,
  type TimesheetCapacity,
  type TimesheetEntry,
} from '../timesheetData'

const WEEK = { from: '2026-07-13', to: '2026-07-19' }

function entry(date: string, durationMinutes: number): TimesheetEntry {
  return {
    id: `entry-${date}-${durationMinutes}`,
    date,
    taskId: null,
    taskTitle: null,
    timeProjectId: 'project-1',
    projectLabel: 'Nordvik',
    description: null,
    startText: '',
    endText: '',
    durationMinutes,
    roundedMinutes: null,
    isBillable: true,
    cost: null,
    currencyCode: null,
    rateOverrideAmount: null,
    isLocked: false,
    lockedReportId: null,
    updatedAt: null,
    tagIds: [],
    staffMemberId: 'staff-1',
  }
}

const HALF_TIME_WITH_LEAVE: TimesheetCapacity = {
  providerId: 'app.contract_hours',
  targetMinutesByDate: { '2026-07-13': 240, '2026-07-14': 240, '2026-07-15': 240 },
  totalTargetMinutes: 720,
  label: null,
}

describe('summarizeTimesheet with a contributed capacity', () => {
  it('uses the provider total instead of working days × dailyHours', () => {
    const days = buildTimesheetDays(WEEK, [entry('2026-07-13', 240)])
    const summary = summarizeTimesheet(days, WEEK, 8, HALF_TIME_WITH_LEAVE)
    expect(summary.targetMinutes).toBe(720)
    expect(summary.deltaMinutes).toBe(240 - 720)
    expect(summary.workingDays).toBe(5)
  })

  it('shows no shortfall for a week of approved leave', () => {
    const days = buildTimesheetDays(WEEK, [])
    const leave: TimesheetCapacity = { ...HALF_TIME_WITH_LEAVE, targetMinutesByDate: {}, totalTargetMinutes: 0 }
    const summary = summarizeTimesheet(days, WEEK, 8, leave)
    expect(summary.targetMinutes).toBe(0)
    expect(summary.deltaMinutes).toBe(0)
  })

  it('keeps the flat arithmetic when no contributed capacity is passed', () => {
    const days = buildTimesheetDays(WEEK, [])
    expect(summarizeTimesheet(days, WEEK, 8, null).targetMinutes).toBe(2400)
    expect(summarizeTimesheet(days, WEEK, 8).targetMinutes).toBe(2400)
  })
})

describe('per-day targets', () => {
  it('scales the bars by the largest per-day target the provider answered', () => {
    const days = buildTimesheetDays(WEEK, [entry('2026-07-13', 600)])
    expect(resolveLoadScaleMinutes(days, 8, HALF_TIME_WITH_LEAVE)).toBe(240)
    expect(resolveLoadScaleMinutes(days, 8)).toBe(480)
  })

  it('falls back to the longest day when the provider answered no target for the period', () => {
    const days = buildTimesheetDays(WEEK, [entry('2026-07-13', 600)])
    const none: TimesheetCapacity = { ...HALF_TIME_WITH_LEAVE, targetMinutesByDate: {}, totalTargetMinutes: 0 }
    expect(resolveLoadScaleMinutes(days, 8, none)).toBe(600)
  })

  it('gives a day the provider left out no target rather than a shortfall', () => {
    const map = HALF_TIME_WITH_LEAVE.targetMinutesByDate
    expect(resolveDayTargetMinutes({ date: '2026-07-13', isWeekend: false }, 480, map)).toBe(240)
    expect(resolveDayTargetMinutes({ date: '2026-07-16', isWeekend: false }, 480, map)).toBeNull()
    expect(resolveDayTargetMinutes({ date: '2026-07-16', isWeekend: false }, 480)).toBe(480)
    expect(resolveDayTargetMinutes({ date: '2026-07-18', isWeekend: true }, 480)).toBeNull()
  })

  it("draws a day's bar against its own target, otherwise the period scale", () => {
    const map = HALF_TIME_WITH_LEAVE.targetMinutesByDate
    expect(resolveDayScaleMinutes('2026-07-13', 480, map)).toBe(240)
    expect(resolveDayScaleMinutes('2026-07-16', 480, map)).toBe(480)
    expect(resolveDayScaleMinutes('2026-07-13', 480)).toBe(480)
  })

  it('opens the day with the largest shortfall against the provider target, skipping leave days', () => {
    const days = buildTimesheetDays(WEEK, [
      entry('2026-07-13', 240),
      entry('2026-07-14', 60),
      entry('2026-07-15', 240),
    ])
    expect(pickDefaultExpandedDay(days, 8, '2026-07-17', HALF_TIME_WITH_LEAVE)).toBe('2026-07-14')
    expect(pickDefaultExpandedDay(days, 8, '2026-07-17')).toBe('2026-07-17')
  })
})
