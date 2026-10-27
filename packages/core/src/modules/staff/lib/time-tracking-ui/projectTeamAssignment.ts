import { formatDuration } from '../time-tracking/duration'
import { DEFAULT_ASSIGNMENT_GRACE_DAYS, MAX_ASSIGNMENT_GRACE_DAYS } from '../time-tracking/settings'

const MS_PER_DAY = 86_400_000
const ISO_DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/

export type AssignedMember = {
  membershipId: string
  staffMemberId: string
  role: string | null
  status: string | null
  startDate: string | null
  endDate: string | null
}

export type TeamDraft = {
  selectedStaffMemberIds: ReadonlySet<string>
  endDateByStaffMemberId: ReadonlyMap<string, string | null>
}

export type TeamChangeSet = {
  additions: string[]
  removals: AssignedMember[]
  endDateUpdates: Array<{ member: AssignedMember; endDate: string | null }>
}

export type AssignmentState = 'active' | 'scheduled' | 'expired'

/**
 * Client-side twin of the server day comparison in
 * `lib/time-tracking/access.ts`. `assigned_start_date` / `assigned_end_date` are
 * `date` columns, so both bounds are whole days, never timestamps.
 */
export function toDayIndex(value: string | Date | null | undefined): number | null {
  if (value == null) return null
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / MS_PER_DAY
  }
  const match = ISO_DATE_PREFIX.exec(String(value).trim())
  if (!match) return null
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / MS_PER_DAY
}

/** Normalizes a `date` column value into the `YYYY-MM-DD` a date input expects. */
export function toIsoDate(value: string | Date | null | undefined): string | null {
  if (value == null) return null
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')
    return `${value.getFullYear()}-${month}-${day}`
  }
  const match = ISO_DATE_PREFIX.exec(String(value).trim())
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null
}

/**
 * Mirrors `normalizeAssignmentGraceDays` for the browser. The server helper
 * cannot be imported here because it ships with the ORM-backed access resolver.
 */
export function resolveGraceDays(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return DEFAULT_ASSIGNMENT_GRACE_DAYS
  if (value < 0 || value > MAX_ASSIGNMENT_GRACE_DAYS) return DEFAULT_ASSIGNMENT_GRACE_DAYS
  return value
}

/**
 * D-12: a membership only grants access from `assigned_start_date` until
 * `assigned_end_date` plus the tenant's grace days. A row outside that window
 * still exists but no longer opens the project, so the drawer must not draw it
 * as an ordinary assignment.
 */
export function resolveAssignmentState(
  member: Pick<AssignedMember, 'startDate' | 'endDate'>,
  graceDays: number,
  now: Date = new Date(),
): AssignmentState {
  const todayIndex = toDayIndex(now)
  if (todayIndex === null) return 'active'
  const startIndex = toDayIndex(member.startDate)
  if (startIndex !== null && todayIndex < startIndex) return 'scheduled'
  const endIndex = toDayIndex(member.endDate)
  if (endIndex === null) return 'active'
  return todayIndex > endIndex + resolveGraceDays(graceDays) ? 'expired' : 'active'
}

export function formatProjectMinutes(minutes: number): string {
  return formatDuration(Number.isFinite(minutes) ? minutes : 0, 'clock')
}

export function diffTeamSelection(
  assigned: readonly AssignedMember[],
  draft: TeamDraft,
  lockedStaffMemberIds: ReadonlySet<string> = new Set<string>(),
): TeamChangeSet {
  const assignedByStaffMemberId = new Map<string, AssignedMember>()
  for (const member of assigned) {
    if (!assignedByStaffMemberId.has(member.staffMemberId)) {
      assignedByStaffMemberId.set(member.staffMemberId, member)
    }
  }

  const additions: string[] = []
  for (const staffMemberId of draft.selectedStaffMemberIds) {
    if (assignedByStaffMemberId.has(staffMemberId)) continue
    if (lockedStaffMemberIds.has(staffMemberId)) continue
    additions.push(staffMemberId)
  }

  const removals: AssignedMember[] = []
  const endDateUpdates: Array<{ member: AssignedMember; endDate: string | null }> = []
  for (const member of assignedByStaffMemberId.values()) {
    if (lockedStaffMemberIds.has(member.staffMemberId)) continue
    if (!draft.selectedStaffMemberIds.has(member.staffMemberId)) {
      removals.push(member)
      continue
    }
    if (!draft.endDateByStaffMemberId.has(member.staffMemberId)) continue
    const nextEndDate = draft.endDateByStaffMemberId.get(member.staffMemberId) ?? null
    if (toIsoDate(nextEndDate) === toIsoDate(member.endDate)) continue
    endDateUpdates.push({ member, endDate: toIsoDate(nextEndDate) })
  }

  return { additions, removals, endDateUpdates }
}

export function countPendingChanges(changes: TeamChangeSet): number {
  return changes.additions.length + changes.removals.length + changes.endDateUpdates.length
}

/**
 * Slavic plural buckets (Polish is the mockup's source language); locales with
 * fewer forms simply translate `few` and `many` to the same string.
 */
export function selectChangeCountKey(count: number): 'one' | 'few' | 'many' {
  const safe = Math.abs(Math.trunc(Number.isFinite(count) ? count : 0))
  if (safe === 1) return 'one'
  const lastTwo = safe % 100
  if (lastTwo >= 12 && lastTwo <= 14) return 'many'
  const last = safe % 10
  return last >= 2 && last <= 4 ? 'few' : 'many'
}
