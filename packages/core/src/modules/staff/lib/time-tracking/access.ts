import type { EntityManager } from '@mikro-orm/postgresql'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import { findWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { StaffTeamMember, StaffTimeProjectMember } from '../../data/entities'
import { DEFAULT_ASSIGNMENT_GRACE_DAYS, MAX_ASSIGNMENT_GRACE_DAYS } from './settings'

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

export type ProjectAccess = {
  canManageAll: boolean
  projectIds: string[]
  staffMemberId: string | null
}

const DENIED: ProjectAccess = { canManageAll: false, projectIds: [], staffMemberId: null }

const MS_PER_DAY = 86_400_000
const ISO_DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/

export function normalizeAssignmentGraceDays(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return DEFAULT_ASSIGNMENT_GRACE_DAYS
  if (value < 0 || value > MAX_ASSIGNMENT_GRACE_DAYS) return DEFAULT_ASSIGNMENT_GRACE_DAYS
  return value
}

/**
 * `assigned_start_date` / `assigned_end_date` are `date` columns, so both bounds
 * are compared as whole days rather than timestamps. Date instances are read
 * through their local calendar fields because the postgres driver materialises a
 * `date` as local midnight, and "today" likewise means the server's local day.
 */
function toDayIndex(value: unknown): number | null {
  if (value == null) return null
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / MS_PER_DAY
  }
  if (typeof value === 'string') {
    const match = ISO_DATE_PREFIX.exec(value.trim())
    if (!match) return null
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / MS_PER_DAY
  }
  return null
}

/**
 * A membership only grants access inside its assignment window: from
 * `assigned_start_date` until `assigned_end_date` plus the tenant's grace days.
 * A null end date is open-ended and never expires.
 */
export function isWithinAssignmentWindow(
  membership: Pick<StaffTimeProjectMember, 'assignedStartDate' | 'assignedEndDate'>,
  todayIndex: number,
  graceDays: number,
): boolean {
  if (membership.assignedStartDate != null) {
    const startIndex = toDayIndex(membership.assignedStartDate)
    if (startIndex === null || todayIndex < startIndex) return false
  }
  if (membership.assignedEndDate == null) return true
  const endIndex = toDayIndex(membership.assignedEndDate)
  if (endIndex === null) return false
  return todayIndex <= endIndex + graceDays
}

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
  const seen = new Set<string>()
  for (const membership of memberships) {
    const projectId = membership.timeProjectId
    if (!projectId || seen.has(projectId)) continue
    if (todayIndex === null || !isWithinAssignmentWindow(membership, todayIndex, graceDays)) continue
    seen.add(projectId)
    projectIds.push(projectId)
  }

  return { canManageAll: false, projectIds, staffMemberId }
}

export function assertProjectAccess(access: ProjectAccess, projectId?: string | null): boolean {
  if (access.canManageAll) return true
  if (!projectId) return false
  return access.projectIds.includes(projectId)
}
