import type { EntityManager } from '@mikro-orm/postgresql'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import { findWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { StaffTeamMember, StaffTimeProjectMember } from '../../data/entities'
import { isWithinAssignmentWindow, normalizeAssignmentGraceDays, toDayIndex, toEntryDayIndex } from './projectAssignment'

export const MANAGE_PROJECTS_FEATURE = 'staff.timesheets.projects.manage'

export type ProjectAccessContext = {
  em: EntityManager
  userId?: string | null
  tenantId?: string | null
  organizationId?: string | null
  userFeatures?: readonly string[]
  /**
   * The manage-all decision, resolved by the caller through `resolveFeatureAccess`.
   * Preferred over `userFeatures`: a grant array cannot distinguish "denied" from
   * "could not ask", and the difference is a silently downgraded manager.
   */
  canManageAll?: boolean
  /**
   * Resolved `access.assignmentGraceDays` setting. Passed in rather than read
   * here so the resolver stays independent of `ModuleConfigService`; callers
   * that already read the tenant settings avoid a second lookup.
   */
  assignmentGraceDays?: number | null
  /** Injectable clock so the assignment window is testable; defaults to now. */
  now?: Date
}

export type AssignmentWindow = {
  startIndex: number | null
  endIndex: number | null
}

export type ProjectAccess = {
  canManageAll: boolean
  projectIds: string[]
  staffMemberId: string | null
  /**
   * The windows (day indexes, end already extended by the grace days) of the
   * memberships that granted each project in `projectIds`. Absent on a hand-built
   * access, which then places no bound on the entry date.
   */
  assignmentWindows?: Record<string, AssignmentWindow[]>
}

const DENIED: ProjectAccess = { canManageAll: false, projectIds: [], staffMemberId: null }

export { isWithinAssignmentWindow, normalizeAssignmentGraceDays, toDayIndex }

export async function resolveProjectAccess(ctx: ProjectAccessContext): Promise<ProjectAccess> {
  const tenantId = ctx.tenantId ?? null
  const organizationId = ctx.organizationId ?? null
  const userId = ctx.userId ?? null
  const grantedFeatures = ctx.userFeatures ?? []

  // The decision is the caller's to make, through `resolveFeatureAccess`, which
  // asks the RBAC service once and fails closed loudly. Deriving it here from a
  // grant array is what let a failed lookup pass as "no permission": the array
  // came back empty, `canManageAll` went false, and a manager silently dropped to
  // their own memberships while the KPI endpoint — asking the service directly —
  // kept reporting the full portfolio.
  //
  // The array path remains for callers that have not been migrated, but it cannot
  // distinguish "denied" from "could not ask", so it is deprecated.
  const canManageAll =
    ctx.canManageAll ??
    authorizeFeatures([MANAGE_PROJECTS_FEATURE], {
      grantedFeatures,
      scopeAllowed: Boolean(tenantId) && Boolean(organizationId),
    })

  if (!tenantId || !organizationId || !userId) {
    return canManageAll ? { ...DENIED, canManageAll } : { ...DENIED }
  }

  const scope = { tenantId, organizationId }
  const staffMember = await findOneWithDecryption(
    ctx.em,
    StaffTeamMember,
    { userId, tenantId, organizationId, deletedAt: null },
    {},
    scope,
  )
  const staffMemberId = staffMember?.id ?? null

  if (canManageAll) return { canManageAll: true, projectIds: [], staffMemberId }
  if (!staffMemberId) return { ...DENIED }

  const memberships = await findWithDecryption(
    ctx.em,
    StaffTimeProjectMember,
    { staffMemberId, tenantId, organizationId, status: 'active', deletedAt: null },
    {},
    scope,
  )

  const graceDays = normalizeAssignmentGraceDays(ctx.assignmentGraceDays)
  const todayIndex = toDayIndex(ctx.now ?? new Date())

  const projectIds: string[] = []
  const assignmentWindows: Record<string, AssignmentWindow[]> = {}
  for (const membership of memberships) {
    const projectId = membership.timeProjectId
    if (!projectId) continue
    if (todayIndex === null || !isWithinAssignmentWindow(membership, todayIndex, graceDays)) continue
    const endIndex = toDayIndex(membership.assignedEndDate)
    const window: AssignmentWindow = {
      startIndex: toDayIndex(membership.assignedStartDate),
      endIndex: endIndex === null ? null : endIndex + graceDays,
    }
    const windows = assignmentWindows[projectId]
    if (windows) {
      windows.push(window)
      continue
    }
    assignmentWindows[projectId] = [window]
    projectIds.push(projectId)
  }

  return { canManageAll: false, projectIds, staffMemberId, assignmentWindows }
}

/**
 * Whether the caller may write time dated `date` on `projectId`. On top of the
 * today-based access `resolveProjectAccess` grants (D-12), the entry's own date
 * must fall inside one of the windows of the memberships that granted it: from
 * `assigned_start_date` until `assigned_end_date` plus the grace days. An
 * unparseable date fails closed.
 */
export function isProjectAccessibleOnDate(
  access: ProjectAccess,
  projectId: string | null | undefined,
  date: Date | string | null | undefined,
): boolean {
  if (access.canManageAll) return true
  if (!projectId || !access.projectIds.includes(projectId)) return false
  const windows = access.assignmentWindows?.[projectId]
  if (!windows) return true
  const dateIndex = toEntryDayIndex(date)
  if (dateIndex === null) return false
  return windows.some(
    (window) =>
      (window.startIndex === null || dateIndex >= window.startIndex) &&
      (window.endIndex === null || dateIndex <= window.endIndex),
  )
}

export function assertProjectAccess(access: ProjectAccess, projectId?: string | null): boolean {
  if (access.canManageAll) return true
  if (!projectId) return false
  return access.projectIds.includes(projectId)
}
