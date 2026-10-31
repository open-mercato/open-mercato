import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { StaffTeamMember, StaffTimeProjectMember } from '../../data/entities'
import { DEFAULT_ASSIGNMENT_GRACE_DAYS, MAX_ASSIGNMENT_GRACE_DAYS } from './settingKeys'

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
export function toDayIndex(value: unknown): number | null {
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
 * An entry date is a calendar day the client sent as `YYYY-MM-DD`, which
 * `z.coerce.date()` turns into UTC midnight — so a Date is read through its UTC
 * fields here, the same way the grid addresses a cell (D-8).
 */
export function toEntryDayIndex(value: unknown): number | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()) / MS_PER_DAY
  }
  return toDayIndex(value)
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


export type ProjectAssignmentScope = {
  tenantId: string
  organizationId: string
}

export type ActiveProjectMember = {
  membershipId: string
  staffMemberId: string
  userId: string | null
  isAssigner: boolean
}

type MembershipLike = Pick<
  StaffTimeProjectMember,
  'status' | 'deletedAt' | 'assignedStartDate' | 'assignedEndDate'
>

export function isActiveAssignment(membership: MembershipLike, now: Date, graceDays: number): boolean {
  if (membership.status !== 'active' || membership.deletedAt) return false
  const todayIndex = toDayIndex(now)
  if (todayIndex === null) return false
  return isWithinAssignmentWindow(membership, todayIndex, normalizeAssignmentGraceDays(graceDays))
}

export async function loadActiveProjectMembers(
  em: EntityManager,
  scope: ProjectAssignmentScope,
  timeProjectId: string,
  options: { graceDays?: number | null; now?: Date; assignersOnly?: boolean } = {},
): Promise<ActiveProjectMember[]> {
  const where: Record<string, unknown> = {
    timeProjectId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    status: 'active',
    deletedAt: null,
  }
  if (options.assignersOnly) where.isAssigner = true
  const memberships = await em.find(StaffTimeProjectMember, where)
  const now = options.now ?? new Date()
  const graceDays = normalizeAssignmentGraceDays(options.graceDays)
  const active = memberships.filter((membership) => isActiveAssignment(membership, now, graceDays))
  if (active.length === 0) return []
  const staffMembers = await findWithDecryption(
    em,
    StaffTeamMember,
    {
      id: { $in: Array.from(new Set(active.map((membership) => membership.staffMemberId))) },
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    {},
    scope,
  )
  const userByMember = new Map(staffMembers.map((member) => [member.id, member.userId ?? null]))
  return active
    .filter((membership) => userByMember.has(membership.staffMemberId))
    .map((membership) => ({
      membershipId: membership.id,
      staffMemberId: membership.staffMemberId,
      userId: userByMember.get(membership.staffMemberId) ?? null,
      isAssigner: membership.isAssigner === true,
    }))
}

export async function resolveUsableDefaultAssignee(
  em: EntityManager,
  scope: ProjectAssignmentScope,
  project: { id: string; defaultAssigneeStaffMemberId?: string | null },
  options: { graceDays?: number | null; now?: Date } = {},
): Promise<string | null> {
  const candidate = project.defaultAssigneeStaffMemberId ?? null
  if (!candidate) return null
  const members = await loadActiveProjectMembers(em, scope, project.id, options)
  return members.some((member) => member.staffMemberId === candidate) ? candidate : null
}

export async function isActiveProjectAssigner(
  em: EntityManager,
  scope: ProjectAssignmentScope,
  timeProjectId: string,
  staffMemberId: string,
  options: { graceDays?: number | null; now?: Date } = {},
): Promise<boolean> {
  const assigners = await loadActiveProjectMembers(em, scope, timeProjectId, { ...options, assignersOnly: true })
  return assigners.some((member) => member.staffMemberId === staffMemberId)
}

type ConfigContainer = { resolve: (name: string) => unknown }

export async function resolveAssignmentGraceDaysFromContainer(
  container: ConfigContainer,
  tenantId: string,
): Promise<number | null> {
  try {
    const { readTimeTrackingSettings } = await import('./settings')
    const configService = container.resolve('moduleConfigService') as Parameters<typeof readTimeTrackingSettings>[0]
    const settings = await readTimeTrackingSettings(configService, { tenantId })
    return settings.access.assignmentGraceDays
  } catch {
    return null
  }
}
