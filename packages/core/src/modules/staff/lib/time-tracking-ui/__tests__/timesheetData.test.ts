// T5.2 / T5.3 — the day buckets, load bars, footer totals and the two smart
// defaults the mockups ask for (screen 11 notes 1 and 6, screen 12 notes 2–4).

import {
  buildTimesheetDays,
  entryChipLabel,
  indexDaysByDate,
  loadPercent,
  pickDefaultExpandedDay,
  resolveLoadScaleMinutes,
  suggestNextStartClock,
  summarizeTimesheet,
  toTimesheetEntry,
  type TimesheetEntry,
} from '../timesheetData'

const WEEK = { from: '2026-07-13', to: '2026-07-19' }

function entry(overrides: Partial<TimesheetEntry> & { id: string; date: string }): TimesheetEntry {
  return {
    taskId: null,
    taskTitle: null,
    timeProjectId: 'project-1',
    projectLabel: 'Nordvik',
    description: null,
    startText: '',
    endText: '',
    durationMinutes: 60,
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
    ...overrides,
  }
}

describe('toTimesheetEntry', () => {
  it('carries the author, which the entries-list row does not', () => {
    const mapped = toTimesheetEntry({
      id: '11111111-1111-4111-8111-111111111111',
      date: '2026-07-13T00:00:00.000Z',
      staff_member_id: 'staff-9',
      duration_minutes: 120,
      is_billable: false,
    })
    expect(mapped?.staffMemberId).toBe('staff-9')
    expect(mapped?.date).toBe('2026-07-13')
    expect(mapped?.durationMinutes).toBe(120)
    expect(mapped?.isBillable).toBe(false)
  })
})

describe('buildTimesheetDays', () => {
  it('produces one bucket per day of the range, including empty ones', () => {
    const days = buildTimesheetDays(WEEK, [entry({ id: 'a', date: '2026-07-13' })])
    expect(days).toHaveLength(7)
    expect(days[0].totalMinutes).toBe(60)
    expect(days[1].totalMinutes).toBe(0)
    expect(days[5].isWeekend).toBe(true)
  })

  it('separates billable from total and orders a day by its clocks', () => {
    const days = buildTimesheetDays(WEEK, [
      entry({ id: 'late', date: '2026-07-13', startText: '13:00', durationMinutes: 45, isBillable: false }),
      entry({ id: 'early', date: '2026-07-13', startText: '09:00', durationMinutes: 120 }),
    ])
    expect(days[0].entries.map((row) => row.id)).toEqual(['early', 'late'])
    expect(days[0].totalMinutes).toBe(165)
    expect(days[0].billableMinutes).toBe(120)
  })
})

describe('summarizeTimesheet', () => {
  it('scales the target by working days and reports the delta', () => {
    const days = buildTimesheetDays(WEEK, [entry({ id: 'a', date: '2026-07-13', durationMinutes: 2500 })])
    const summary = summarizeTimesheet(days, WEEK, 8)
    expect(summary.workingDays).toBe(5)
    expect(summary.targetMinutes).toBe(2400)
    expect(summary.deltaMinutes).toBe(100)
  })

  it('has neither a target nor a delta when the tenant cleared the daily hours', () => {
    const days = buildTimesheetDays(WEEK, [entry({ id: 'a', date: '2026-07-13' })])
    const summary = summarizeTimesheet(days, WEEK, null)
    expect(summary.targetMinutes).toBeNull()
    expect(summary.deltaMinutes).toBeNull()
    expect(summary.totalMinutes).toBe(60)
  })

  it('counts weekend time in the total while the target stays on working days (screen 12 note 4)', () => {
    const days = buildTimesheetDays(WEEK, [entry({ id: 'sat', date: '2026-07-18', durationMinutes: 180 })])
    const summary = summarizeTimesheet(days, WEEK, 8)
    expect(summary.totalMinutes).toBe(180)
    expect(summary.targetMinutes).toBe(2400)
  })
})

describe('load bars (screen 11 note 6)', () => {
  it('uses the daily target as the scale when there is one', () => {
    const days = buildTimesheetDays(WEEK, [entry({ id: 'a', date: '2026-07-13', durationMinutes: 240 })])
    expect(resolveLoadScaleMinutes(days, 8)).toBe(480)
    expect(loadPercent(240, 480)).toBe(50)
  })

  it('falls back to the longest day of the period when there is no target', () => {
    const days = buildTimesheetDays(WEEK, [
      entry({ id: 'a', date: '2026-07-13', durationMinutes: 240 }),
      entry({ id: 'b', date: '2026-07-14', durationMinutes: 120 }),
    ])
    expect(resolveLoadScaleMinutes(days, null)).toBe(240)
    expect(loadPercent(120, 240)).toBe(50)
  })

  it('pins an over-target day at 100 and an empty period at 0', () => {
    expect(loadPercent(600, 480)).toBe(100)
    expect(loadPercent(0, 480)).toBe(0)
    expect(loadPercent(60, null)).toBe(0)
    expect(resolveLoadScaleMinutes(buildTimesheetDays(WEEK, []), null)).toBeNull()
  })
})

describe('pickDefaultExpandedDay (screen 12 note 2)', () => {
  // Screen 12's own week: 8:00 / 6:45 / 8:30 / 6:00 / 4:15.
  const days = () =>
    buildTimesheetDays(WEEK, [
      entry({ id: 'mon', date: '2026-07-13', durationMinutes: 480 }),
      entry({ id: 'tue', date: '2026-07-14', durationMinutes: 405 }),
      entry({ id: 'wed', date: '2026-07-15', durationMinutes: 510 }),
      entry({ id: 'thu', date: '2026-07-16', durationMinutes: 360 }),
      entry({ id: 'fri', date: '2026-07-17', durationMinutes: 255 }),
    ])

  it('expands the working day with the largest shortfall against the target', () => {
    expect(pickDefaultExpandedDay(days(), 8, '2026-07-19')).toBe('2026-07-17')
  })

  it('never expands a day that has not happened yet', () => {
    // On Tuesday, Friday's "gap" is the future, not a gap.
    expect(pickDefaultExpandedDay(days(), 8, '2026-07-14')).toBe('2026-07-14')
  })

  it('falls back to the most recent day with entries when there is no target', () => {
    expect(pickDefaultExpandedDay(days(), null, '2026-07-19')).toBe('2026-07-17')
  })

  it('answers null for a period entirely in the future', () => {
    expect(pickDefaultExpandedDay(days(), 8, '2026-07-01')).toBeNull()
  })
})

describe('suggestNextStartClock (screen 12 note 3)', () => {
  it('offers the latest end of the day, not the last row in document order', () => {
    const days = buildTimesheetDays(WEEK, [
      entry({ id: 'a', date: '2026-07-17', startText: '09:15', endText: '13:30' }),
      entry({ id: 'b', date: '2026-07-17', startText: '08:00', endText: '09:00' }),
    ])
    expect(suggestNextStartClock(days[4])).toBe('13:30')
  })

  it('answers null when the day carries no clocks at all', () => {
    const days = buildTimesheetDays(WEEK, [entry({ id: 'a', date: '2026-07-17' })])
    expect(suggestNextStartClock(days[4])).toBeNull()
    expect(suggestNextStartClock(null)).toBeNull()
  })
})

describe('misc', () => {
  it('indexes days by date', () => {
    const days = buildTimesheetDays(WEEK, [])
    expect(indexDaysByDate(days).get('2026-07-15')?.date).toBe('2026-07-15')
  })

  it('always has something to render in a chip', () => {
    expect(entryChipLabel(entry({ id: 'a', date: '2026-07-13' }), '—')).toBe('Nordvik')
    expect(
      entryChipLabel(entry({ id: 'a', date: '2026-07-13', projectLabel: null, taskTitle: 'Task' }), '—'),
    ).toBe('Task')
    expect(
      entryChipLabel(entry({ id: 'a', date: '2026-07-13', projectLabel: null, description: 'Note' }), '—'),
    ).toBe('Note')
    expect(entryChipLabel(entry({ id: 'a', date: '2026-07-13', projectLabel: null }), '—')).toBe('—')
  })
})
