import { zonedWallTimeToInstant } from '@open-mercato/core/modules/planner/lib/availabilityTimezone'
import type {
  AvailabilityRange,
  PlannerAvailabilityService,
} from '@open-mercato/core/modules/planner/services/plannerAvailabilityService'

export const AVAILABILITY_WINDOW_DAY_MS = 24 * 60 * 60 * 1000

export const staffAvailabilityWindowKinds = ['unavailable', 'leave', 'tentative'] as const
type WindowKind = typeof staffAvailabilityWindowKinds[number]
type Period = { start: number; end: number }
type Window = Period & { kind: WindowKind; reason?: string }

type ScheduleRule = {
  id: string
  rrule: string
  timezone: string
  kind: 'availability' | 'unavailability'
  exdates: string[]
  note?: string | null
  unavailabilityReasonEntryId?: string | null
  unavailabilityReasonValue?: string | null
}

type Leave = {
  startDate: Date
  endDate: Date
  timezone: string
  status: 'pending' | 'approved' | 'rejected'
  note?: string | null
  unavailabilityReasonEntryId?: string | null
  unavailabilityReasonValue?: string | null
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function clippedPeriod(start: Date, end: Date, range: AvailabilityRange): Period {
  return {
    start: Math.max(start.getTime(), range.start.getTime()),
    end: Math.min(end.getTime(), range.end.getTime()),
  }
}

function mergePeriods<T extends Period>(periods: readonly T[]): T[] {
  const sorted = [...periods].sort((left, right) => left.start - right.start || left.end - right.end)
  const merged: T[] = []
  for (const period of sorted) {
    if (period.start >= period.end) continue
    const previous = merged.at(-1)
    if (previous && period.start <= previous.end) {
      previous.end = Math.max(previous.end, period.end)
    } else {
      merged.push({ ...period })
    }
  }
  return merged
}

function subtractPeriods(period: Period, blockers: readonly Period[]): Period[] {
  const remaining: Period[] = []
  let start = period.start
  for (const blocker of blockers) {
    if (blocker.end <= start) continue
    if (blocker.start >= period.end) break
    if (blocker.start > start) remaining.push({ start, end: blocker.start })
    start = Math.max(start, blocker.end)
  }
  if (start < period.end) remaining.push({ start, end: period.end })
  return remaining
}

export function resolveStaffLeaveRange(startDate: Date, endDate: Date, timezone: string): AvailabilityRange | null {
  if (!Number.isFinite(+startDate) || !Number.isFinite(+endDate)) return null
  const start = zonedWallTimeToInstant(isoDate(startDate), '00:00', timezone)
  const followingDay = new Date(+endDate)
  followingDay.setUTCDate(followingDay.getUTCDate() + 1)
  const end = zonedWallTimeToInstant(isoDate(followingDay), '00:00', timezone)
  return start && end && start < end ? { start, end } : null
}

function leavePeriod(request: Leave, range: AvailabilityRange): Period | null {
  const leave = resolveStaffLeaveRange(request.startDate, request.endDate, request.timezone)
  return leave ? clippedPeriod(leave.start, leave.end, range) : null
}

function isApprovedLeaveMirror(rule: ScheduleRule, requests: readonly Leave[]): boolean {
  if (rule.kind !== 'unavailability' || rule.exdates.length > 0) return false
  const date = /^DTSTART:(\d{4})(\d{2})(\d{2})T000000Z\nDURATION:PT24H\nRRULE:FREQ=DAILY;COUNT=1$/.exec(rule.rrule)
  if (!date) return false
  const dateKey = `${date[1]}-${date[2]}-${date[3]}`
  return requests.some((request) => request.status === 'approved'
    && rule.timezone === request.timezone
    && (rule.note ?? null) === (request.note ?? null)
    && (rule.unavailabilityReasonEntryId ?? null) === (request.unavailabilityReasonEntryId ?? null)
    && (rule.unavailabilityReasonValue ?? null) === (request.unavailabilityReasonValue ?? null)
    && isoDate(request.startDate) <= dateKey
    && dateKey <= isoDate(request.endDate))
}

function mergeMatchingWindows(windows: Window[]): Window[] {
  const groups = new Map<string, Window[]>()
  for (const window of windows) {
    const key = JSON.stringify([window.kind, window.reason])
    const group = groups.get(key)
    if (group) group.push(window)
    else groups.set(key, [window])
  }
  return Array.from(groups.values(), mergePeriods).flat().sort((left, right) =>
    left.start - right.start || left.end - right.end || left.kind.localeCompare(right.kind))
}

function expandExplicitRules(
  rules: readonly ScheduleRule[],
  planner: PlannerAvailabilityService,
  range: AvailabilityRange,
  canReadReasons: boolean,
  weeklyScheduleTemplate: boolean,
): Window[] {
  return rules.flatMap((rule) => {
    if (rule.kind !== 'unavailability') return []
    const reason = canReadReasons ? rule.unavailabilityReasonValue : undefined
    const occurrences = planner.getMergedAvailabilityWindows({
      rules: [{ ...rule, kind: 'availability' }],
      range,
      respectTimezone: true,
      weeklyScheduleTemplate,
    })
    return occurrences.map(({ start, end }) => ({
      ...clippedPeriod(start, end, range),
      kind: 'unavailable',
      ...(reason ? { reason } : {}),
    }))
  })
}

export function buildStaffAvailabilityWindows({
  range,
  planner,
  ruleSetRules,
  memberRules,
  leaveRequests,
  canReadPlannerReasons,
  canReadLeaveReasons,
}: {
  range: AvailabilityRange
  planner: PlannerAvailabilityService
  ruleSetRules: ScheduleRule[] | null
  memberRules: ScheduleRule[]
  leaveRequests: Leave[]
  canReadPlannerReasons: boolean
  canReadLeaveReasons: boolean
}): Window[] {
  const leaveWindows = leaveRequests.flatMap((request): Window[] => {
    if (request.status === 'rejected') return []
    const period = leavePeriod(request, range)
    if (!period || period.start >= period.end) return []
    const reason = canReadLeaveReasons ? request.unavailabilityReasonValue : undefined
    return [{
      ...period,
      kind: request.status === 'approved' ? 'leave' : 'tentative',
      ...(reason ? { reason } : {}),
    }]
  })
  const approved = mergePeriods(leaveWindows.filter((window) => window.kind === 'leave'))
  const manualMemberRules = memberRules.filter((rule) => !isApprovedLeaveMirror(rule, leaveRequests))
  const hasMemberSchedule = manualMemberRules.some((rule) => rule.kind === 'availability')
  const useTemplate = ruleSetRules !== null && !hasMemberSchedule
  const explicitRules = [
    ...expandExplicitRules(manualMemberRules, planner, range, canReadPlannerReasons, false),
    ...expandExplicitRules(useTemplate ? ruleSetRules : [], planner, range, canReadPlannerReasons, true),
  ]
  const explicit = explicitRules.flatMap((window) =>
    subtractPeriods(window, approved).map((period) => ({ ...window, ...period })))

  const availability = ruleSetRules === null ? [] : planner.getMergedAvailabilityWindows({
    rules: useTemplate ? ruleSetRules : manualMemberRules,
    range,
    respectTimezone: true,
    weeklyScheduleTemplate: useTemplate,
  }).map(({ start, end }) => clippedPeriod(start, end, range))
  const outsideHours: Window[] = ruleSetRules === null ? [] : subtractPeriods(
    { start: range.start.getTime(), end: range.end.getTime() },
    mergePeriods([...availability, ...explicit, ...approved]),
  ).map((period) => ({ ...period, kind: 'unavailable' }))

  return [...leaveWindows, ...explicit, ...outsideHours]
}

export function mergeStaffAvailabilityWindows(windows: Window[]) {
  return mergeMatchingWindows(windows).map(({ start, end, ...window }) => ({
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    ...window,
  }))
}
