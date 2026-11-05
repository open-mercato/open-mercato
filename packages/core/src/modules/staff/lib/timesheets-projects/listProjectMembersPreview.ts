import type { EntityManager } from '@mikro-orm/postgresql'
import { StaffTeamMember, StaffTimeProjectMember } from '../../data/entities'
import { computeInitials } from './initials'

export { computeInitials }

export type MembersPreviewScope = {
  em: EntityManager
  organizationId: string
  tenantId: string
  projectIds: string[]
  maxPerProject?: number
}

export type MemberPreview = {
  id: string
  name: string
  initials: string
  avatarUrl: string | null
}

export type ProjectMembersPreview = {
  total: number
  preview: MemberPreview[]
  myRole: string | null
}

const DEFAULT_MAX = 4

export async function listProjectMembersPreview(
  scope: MembersPreviewScope & { callerStaffMemberId?: string | null },
): Promise<Map<string, ProjectMembersPreview>> {
  const maxPerProject = scope.maxPerProject ?? DEFAULT_MAX
  const result = new Map<string, ProjectMembersPreview>()
  for (const id of scope.projectIds) {
    result.set(id, { total: 0, preview: [], myRole: null })
  }
  if (scope.projectIds.length === 0) return result

  const em = scope.em.fork()
  const memberships = await em.find(
    StaffTimeProjectMember,
    {
      timeProjectId: { $in: scope.projectIds },
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      status: 'active',
      deletedAt: null,
    },
    { orderBy: { createdAt: 'asc' } },
  )

  const staffMemberIds = Array.from(new Set(memberships.map((m) => m.staffMemberId)))
  if (staffMemberIds.length === 0) return result

  const teamMembers = await em.find(StaffTeamMember, {
    id: { $in: staffMemberIds },
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  const teamById = new Map(teamMembers.map((tm) => [tm.id, tm]))

  for (const membership of memberships) {
    const bucket = result.get(membership.timeProjectId)
    if (!bucket) continue
    bucket.total += 1
    if (scope.callerStaffMemberId && membership.staffMemberId === scope.callerStaffMemberId) {
      bucket.myRole = membership.role ?? null
    }
    if (bucket.preview.length >= maxPerProject) continue
    const team = teamById.get(membership.staffMemberId)
    if (!team) continue
    bucket.preview.push({
      id: team.id,
      name: team.displayName,
      initials: computeInitials(team.displayName),
      avatarUrl: null,
    })
  }

  return result
}
