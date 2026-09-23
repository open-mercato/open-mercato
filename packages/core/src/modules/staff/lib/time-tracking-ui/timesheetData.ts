/**
 * The reading half of the timesheet (screens 11 and 12) — day buckets, load
 * bars, the period footer and the two "smart" defaults the mockups ask for.
 *
 * Kept pure and out of the React tree for the same reason as `timesheetPeriod`:
 * every number a consultant will later defend in front of a client should be
 * testable as arithmetic.
 *
 * Three decisions are encoded here rather than in a component:
 *
 *  1. **A load bar has a scale even without a target.** Screen 11 note 6 is
 *     explicit that `targets.dailyHours` is a proposal; when a tenant clears it
 *     the bars scale to the longest day of the period instead of disappearing,
 *     so "light day vs heavy day" (US-E3) still reads at a glance.
 *  2. **Weekends do not raise the target but do raise the total** (screen 12
 *     note 4). `countWorkingDays` supplies the target; the totals sum every day.
 *  3. **Money is never summed across currencies** — this module deliberately
 *     exposes no money total at all. The timesheet is a time surface; cost lives
 *     on the entries list and the report, both of which subtotal per currency.
 */

import {
  countWorkingDays,
  eachDayIso,
  isWeekendIso,
  type TimesheetDateRange,
} from './timesheetPeriod'
import { toTimeEntryListRow, type TimeEntryDirectory, type TimeEntryListRow } from './timeEntryListData'
import { readRowString, type ApiRow } from './timeEntryDialogState'

/**
 * A timesheet row is an entries-list row plus the person who logged it — a Team
 * Leader filtering to "everyone" needs the author on the line (screen 12 note 1),
 * and a Team Member never sees a row that is not theirs anyway.
 */
export type TimesheetEntry = TimeEntryListRow & {
  staffMemberId: string | null
}

export function toTimesheetEntry(row: ApiRow, directory?: TimeEntryDirectory): TimesheetEntry | null {
  const base = toTimeEntryListRow(row, directory)
  if (!base) return null
  return { ...base, staffMemberId: readRowString(row, 'staff_member_id', 'staffMemberId') }
}

export type TimesheetDay = {
  date: string
  isWeekend: boolean
  entries: TimesheetEntry[]
  totalMinutes: number
  billableMinutes: number
}

export function buildTimesheetDays(
  range: TimesheetDateRange,
  entries: readonly TimesheetEntry[],
): TimesheetDay[] {
  const byDate = new Map<string, TimesheetEntry[]>()
  for (const entry of entries) {
    const bucket = byDate.get(entry.date)
    if (bucket) bucket.push(entry)
    else byDate.set(entry.date, [entry])
  }
  return eachDayIso(range).map((date) => {
    const dayEntries = (byDate.get(date) ?? []).slice().sort(compareEntriesByClock)
    let totalMinutes = 0
    let billableMinutes = 0
    for (const entry of dayEntries) {
      const minutes = Number.isFinite(entry.durationMinutes) ? entry.durationMinutes : 0
      totalMinutes += minutes
      if (entry.isBillable) billableMinutes += minutes
    }
    return { date, isWeekend: isWeekendIso(date), entries: dayEntries, totalMinutes, billableMinutes }
  })
}

/** Entries read top-to-bottom in the order the day was worked; clock-less ones last. */
function compareEntriesByClock(left: TimesheetEntry, right: TimesheetEntry): number {
  if (left.startText && right.startText) return left.startText.localeCompare(right.startText)
  if (left.startText) return -1
  if (right.startText) return 1
  return 0
}

export type TimesheetSummary = {
  totalMinutes: number
  billableMinutes: number
  /** `null` when the tenant cleared `targets.dailyHours` — there is then nothing to be over or under. */
  targetMinutes: number | null
  deltaMinutes: number | null
  workingDays: number
}

export function summarizeTimesheet(
  days: readonly TimesheetDay[],
  range: TimesheetDateRange,
  dailyHours: number | null | undefined,
): TimesheetSummary {
  let totalMinutes = 0
  let billableMinutes = 0
  for (const day of days) {
    totalMinutes += day.totalMinutes
    billableMinutes += day.billableMinutes
  }
  const workingDays = countWorkingDays(range)
  const hasTarget = typeof dailyHours === 'number' && Number.isFinite(dailyHours) && dailyHours > 0
  const targetMinutes = hasTarget ? Math.round(workingDays * dailyHours * 60) : null
  return {
    totalMinutes,
    billableMinutes,
    targetMinutes,
    deltaMinutes: targetMinutes === null ? null : totalMinutes - targetMinutes,
    workingDays,
  }
}

/**
 * The scale a day's bar is drawn against. With a daily target it is that target,
 * so 8:00 fills the bar; without one it is the longest day in the period, so the
 * bars still rank the days against each other (screen 11 note 6).
 */
export function resolveLoadScaleMinutes(
  days: readonly TimesheetDay[],
  dailyHours: number | null | undefined,
): number | null {
  if (typeof dailyHours === 'number' && Number.isFinite(dailyHours) && dailyHours > 0) {
    return Math.round(dailyHours * 60)
  }
  let longest = 0
  for (const day of days) {
    if (day.totalMinutes > longest) longest = day.totalMinutes
  }
  return longest > 0 ? longest : null
}

/** 0–100. A day over target pins at 100 — the bar reads "full", the number reads the overage. */
export function loadPercent(totalMinutes: number, scaleMinutes: number | null): number {
  if (!scaleMinutes || scaleMinutes <= 0) return 0
  if (totalMinutes <= 0) return 0
  return Math.min(100, Math.round((totalMinutes / scaleMinutes) * 100))
}

/**
 * Screen 12 note 2 — "only the day that deviates from the target is expanded".
 *
 * Deviation is measured against the daily target on working days that have
 * already happened; a Thursday nobody has worked yet is not a gap, it is the
 * future. The largest shortfall wins, later days breaking ties, so closing out a
 * week always opens on the day that still needs attention. With no target (or no
 * shortfall) the most recent day carrying entries is opened instead, because an
 * all-collapsed list gives the user nothing to act on.
 */
export function pickDefaultExpandedDay(
  days: readonly TimesheetDay[],
  dailyHours: number | null | undefined,
  todayIsoValue: string,
): string | null {
  const past = days.filter((day) => day.date <= todayIsoValue)
  if (past.length === 0) return null
  const hasTarget = typeof dailyHours === 'number' && Number.isFinite(dailyHours) && dailyHours > 0
  if (hasTarget) {
    const target = Math.round(dailyHours * 60)
    let best: { date: string; shortfall: number } | null = null
    for (const day of past) {
      if (day.isWeekend) continue
      const shortfall = target - day.totalMinutes
      if (shortfall <= 0) continue
      if (!best || shortfall > best.shortfall || (shortfall === best.shortfall && day.date > best.date)) {
        best = { date: day.date, shortfall }
      }
    }
    if (best) return best.date
  }
  for (let index = past.length - 1; index >= 0; index -= 1) {
    if (past[index].entries.length > 0) return past[index].date
  }
  return null
}

const CLOCK_PATTERN = /^(\d{1,2}):(\d{2})$/

function clockToMinutes(value: string): number | null {
  const match = CLOCK_PATTERN.exec(value)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/**
 * Screen 12 note 3 — the quick-add row's start time is prefilled with the end of
 * the previous entry of that day. The latest end wins rather than the last row in
 * document order, so an entry added out of sequence cannot drag the suggestion
 * backwards. Returns `null` for a day whose entries carry no clocks, in which
 * case the field simply opens empty.
 */
export function suggestNextStartClock(day: TimesheetDay | null | undefined): string | null {
  if (!day) return null
  let latest: { minutes: number; text: string } | null = null
  for (const entry of day.entries) {
    if (!entry.endText) continue
    const minutes = clockToMinutes(entry.endText)
    if (minutes === null) continue
    if (!latest || minutes > latest.minutes) latest = { minutes, text: entry.endText }
  }
  return latest?.text ?? null
}

export type TimesheetDayIndex = ReadonlyMap<string, TimesheetDay>

export function indexDaysByDate(days: readonly TimesheetDay[]): TimesheetDayIndex {
  const index = new Map<string, TimesheetDay>()
  for (const day of days) index.set(day.date, day)
  return index
}

/**
 * The chip label inside a calendar cell — the project when we know it, the task
 * when we do not, and the description as a last resort. A cell that shows a bare
 * dash tells the user nothing, so something always renders.
 */
export function entryChipLabel(entry: TimesheetEntry, fallback: string): string {
  return entry.projectLabel ?? entry.taskTitle ?? entry.description ?? fallback
}
