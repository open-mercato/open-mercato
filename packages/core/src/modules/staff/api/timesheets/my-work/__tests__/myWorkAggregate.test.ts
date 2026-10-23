// T5.6 — the arithmetic of screen 1's four KPIs.

import { buildMyWorkKpis, pickRecentTaskIds, toMinutes } from '../myWorkAggregate'

const RANGES = {
  week: { from: '2026-07-13', to: '2026-07-19' },
  month: { from: '2026-07-01', to: '2026-07-31' },
}

const TOTALS = {
  todayMinutes: 380,
  weekMinutes: 1905,
  monthMinutes: 7690,
  monthNonBillableMinutes: 255,
}

describe('buildMyWorkKpis', () => {
  it('scales the week and month targets by their working days', () => {
    const kpis = buildMyWorkKpis(TOTALS, RANGES, 8)
    expect(kpis.weekWorkingDays).toBe(5)
    expect(kpis.monthWorkingDays).toBe(23)
    expect(kpis.dailyTargetMinutes).toBe(480)
    expect(kpis.weekTargetMinutes).toBe(2400)
    expect(kpis.monthTargetMinutes).toBe(480 * 23)
  })

  it('answers null targets when the tenant cleared the daily hours', () => {
    const kpis = buildMyWorkKpis(TOTALS, RANGES, null)
    expect(kpis.dailyTargetMinutes).toBeNull()
    expect(kpis.weekTargetMinutes).toBeNull()
    expect(kpis.monthTargetMinutes).toBeNull()
    // The totals themselves are unaffected — a missing target hides the
    // comparison, never the number.
    expect(kpis.monthMinutes).toBe(7690)
  })

  it('reports the non-billable share to one decimal', () => {
    expect(buildMyWorkKpis(TOTALS, RANGES, 8).nonBillableSharePercent).toBe(3.3)
  })

  it('answers null rather than 0% for a month with nothing logged', () => {
    const kpis = buildMyWorkKpis(
      { todayMinutes: 0, weekMinutes: 0, monthMinutes: 0, monthNonBillableMinutes: 0 },
      RANGES,
      8,
    )
    expect(kpis.nonBillableSharePercent).toBeNull()
  })
})

describe('toMinutes', () => {
  it('reads the bigint strings postgres answers with', () => {
    expect(toMinutes('480')).toBe(480)
    expect(toMinutes(480)).toBe(480)
    expect(toMinutes(null)).toBe(0)
    expect(toMinutes('nonsense')).toBe(0)
  })
})

describe('pickRecentTaskIds', () => {
  it('returns the most recently worked tasks, de-duplicated, newest first', () => {
    const picked = pickRecentTaskIds(
      [
        { id: 'e1', date: '2026-07-10', taskId: 'task-a' },
        { id: 'e2', date: '2026-07-17', taskId: 'task-b' },
        { id: 'e3', date: '2026-07-15', taskId: 'task-a' },
        { id: 'e4', date: '2026-07-14', taskId: null },
        { id: 'e5', date: '2026-07-12', taskId: 'task-c' },
      ],
      2,
    )
    expect(picked).toEqual(['task-b', 'task-a'])
  })

  it('answers empty when nothing was logged against a task', () => {
    expect(pickRecentTaskIds([{ id: 'e1', date: '2026-07-10', taskId: null }], 5)).toEqual([])
  })
})

describe('buildMyWorkKpis with an EP-40 capacity provider (#6934)', () => {
  const contributed = (targetMinutesByDate: Record<string, number>, totalTargetMinutes: number | null) => ({
    targetMinutesByDate,
    totalTargetMinutes,
    providerId: 'app.contract_hours',
    isBuiltIn: false,
  })

  it('uses the contributed targets for today, the week and the month', () => {
    const kpis = buildMyWorkKpis(TOTALS, RANGES, 8, {
      today: '2026-07-15',
      week: contributed({ '2026-07-13': 240, '2026-07-15': 240 }, 480),
      month: contributed({}, 5040),
    })
    expect(kpis.dailyTargetMinutes).toBe(240)
    expect(kpis.weekTargetMinutes).toBe(480)
    expect(kpis.monthTargetMinutes).toBe(5040)
    expect(kpis.weekWorkingDays).toBe(5)
  })

  it('answers no daily target for a day the provider left out', () => {
    const kpis = buildMyWorkKpis(TOTALS, RANGES, 8, {
      today: '2026-07-14',
      week: contributed({ '2026-07-13': 240 }, 240),
      month: contributed({}, 240),
    })
    expect(kpis.dailyTargetMinutes).toBeNull()
  })

  it('ignores the built-in answer and keeps the flat arithmetic', () => {
    const builtIn = { targetMinutesByDate: {}, totalTargetMinutes: 0, providerId: 'built-in', isBuiltIn: true }
    const kpis = buildMyWorkKpis(TOTALS, RANGES, 8, { today: '2026-07-15', week: builtIn, month: builtIn })
    expect(kpis.dailyTargetMinutes).toBe(480)
    expect(kpis.weekTargetMinutes).toBe(2400)
    expect(kpis.monthTargetMinutes).toBe(480 * 23)
  })
})
