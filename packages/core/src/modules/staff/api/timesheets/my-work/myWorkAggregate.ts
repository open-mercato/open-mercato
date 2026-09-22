/**
 * The arithmetic behind screen 1 (`GET /api/staff/timesheets/my-work`), kept out
 * of the route so the numbers a consultant reads first thing in the morning can
 * be tested without a database.
 *
 * Three rules it encodes:
 *
 *  1. **Targets scale with working days, not calendar days.** "cel 8:00" is one
 *     day; "z 40:00" is the week's Mon–Fri days times the daily target; the month
 *     KPI's context is its working-day count. A tenant with no `targets.dailyHours`
 *     gets `null` everywhere rather than a zero to be under.
 *  2. **The non-billable KPI is a share of the month, and a share of nothing is
 *     `null`** — not `0%`, which would read as "all your time is billable".
 *  3. **Money never crosses currencies.** The payload carries no total cost at
 *     all: budget burn is per project, in that project's own terms, and the rate
 *     is only present for a caller who may see rates.
 */

import { countWorkingDays, type TimesheetDateRange } from '../../../lib/time-tracking-ui/timesheetPeriod'

export type MyWorkTotals = {
  todayMinutes: number
  weekMinutes: number
  monthMinutes: number
  monthNonBillableMinutes: number
}

export type MyWorkKpis = MyWorkTotals & {
  dailyTargetMinutes: number | null
  weekTargetMinutes: number | null
  monthTargetMinutes: number | null
  weekWorkingDays: number
  monthWorkingDays: number
  /** Percent of the month that is non-billable, rounded to one decimal; `null` when nothing is logged. */
  nonBillableSharePercent: number | null
}

export function buildMyWorkKpis(
  totals: MyWorkTotals,
  ranges: { week: TimesheetDateRange; month: TimesheetDateRange },
  dailyHours: number | null,
): MyWorkKpis {
  const hasTarget = typeof dailyHours === 'number' && Number.isFinite(dailyHours) && dailyHours > 0
  const weekWorkingDays = countWorkingDays(ranges.week)
  const monthWorkingDays = countWorkingDays(ranges.month)
  const dailyTargetMinutes = hasTarget ? Math.round(dailyHours * 60) : null
  return {
    ...totals,
    dailyTargetMinutes,
    weekTargetMinutes: dailyTargetMinutes === null ? null : dailyTargetMinutes * weekWorkingDays,
    monthTargetMinutes: dailyTargetMinutes === null ? null : dailyTargetMinutes * monthWorkingDays,
    weekWorkingDays,
    monthWorkingDays,
    nonBillableSharePercent:
      totals.monthMinutes > 0
        ? Math.round((totals.monthNonBillableMinutes / totals.monthMinutes) * 1000) / 10
        : null,
  }
}

export function toMinutes(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * The most recently worked tasks, newest first, de-duplicated. Screen 1's
 * "Ostatnie zadania" is a shortcut back into work already started, so it is
 * derived from the caller's own entries rather than from task assignment: a task
 * assigned but never touched is not something to resume.
 */
export function pickRecentTaskIds(
  entries: readonly { taskId: string | null; date: string; id: string }[],
  limit: number,
): string[] {
  const ordered = [...entries].sort((left, right) => {
    if (left.date === right.date) return right.id.localeCompare(left.id)
    return right.date.localeCompare(left.date)
  })
  const seen = new Set<string>()
  const picked: string[] = []
  for (const entry of ordered) {
    if (!entry.taskId || seen.has(entry.taskId)) continue
    seen.add(entry.taskId)
    picked.push(entry.taskId)
    if (picked.length >= limit) break
  }
  return picked
}
