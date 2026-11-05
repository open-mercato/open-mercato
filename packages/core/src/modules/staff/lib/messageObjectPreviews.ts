import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { ObjectPreviewData } from '@open-mercato/shared/modules/messages/types'
import type { EntityManager } from '@mikro-orm/postgresql'
import { StaffLeaveRequest, StaffTeam, StaffTeamMember, StaffTeamRole } from '../data/entities'
import { PlannerAvailabilityRuleSet } from '../../planner/data/entities'
import { User } from '../../auth/data/entities'

type PreviewContext = {
  tenantId: string
  organizationId?: string | null
}

function mapStatus(status: string): { label: string; color: string } {
  if (status === 'approved') {
    return { label: 'Approved', color: 'green' }
  }
  if (status === 'rejected') {
    return { label: 'Rejected', color: 'red' }
  }
  return { label: 'Pending', color: 'amber' }
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

export async function loadLeaveRequestPreview(
  entityId: string,
  ctx: PreviewContext,
): Promise<ObjectPreviewData> {
  const { t } = await resolveTranslations()
  const defaultTitle = t('staff.messageObjects.leaveRequest.title')

  if (!ctx.organizationId) {
    return {
      title: defaultTitle,
      subtitle: entityId,
    }
  }

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager

  const request = await findOneWithDecryption(
    em,
    StaffLeaveRequest,
    {
      id: entityId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    undefined,
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )

  if (!request) {
    return {
      title: defaultTitle,
      subtitle: entityId,
      status: t('staff.messageObjects.notFound'),
      statusColor: 'gray',
    }
  }

  const status = mapStatus(request.status)
  const memberName = typeof request.member?.displayName === 'string' ? request.member.displayName : null
  const subtitle = memberName
    ? `${memberName} - ${formatDate(request.startDate)} to ${formatDate(request.endDate)}`
    : `${formatDate(request.startDate)} to ${formatDate(request.endDate)}`

  return {
    title: 'Leave request',
    subtitle,
    status: status.label,
    statusColor: status.color,
    metadata: {
      'Start date': formatDate(request.startDate),
      'End date': formatDate(request.endDate),
      Timezone: request.timezone,
    },
  }
}

export async function loadTeamPreview(
  entityId: string,
  ctx: PreviewContext,
): Promise<ObjectPreviewData> {
  const { t } = await resolveTranslations()
  const defaultTitle = t('staff.messageObjects.team.title')

  if (!ctx.organizationId) {
    return {
      title: defaultTitle,
      subtitle: entityId,
    }
  }

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager

  const team = await findOneWithDecryption(
    em,
    StaffTeam,
    {
      id: entityId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    undefined,
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )

  if (!team) {
    return {
      title: defaultTitle,
      subtitle: entityId,
      status: t('staff.messageObjects.notFound'),
      statusColor: 'gray',
    }
  }

  return {
    title: team.name,
    subtitle: team.description ?? entityId,
    status: team.isActive ? 'Active' : 'Inactive',
    statusColor: team.isActive ? 'green' : 'gray',
  }
}

export async function loadTeamMemberPreview(
  entityId: string,
  ctx: PreviewContext,
): Promise<ObjectPreviewData> {
  const { t } = await resolveTranslations()
  const defaultTitle = t('staff.messageObjects.teamMember.title')

  if (!ctx.organizationId) {
    return {
      title: defaultTitle,
      subtitle: entityId,
    }
  }

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager

  const member = await findOneWithDecryption(
    em,
    StaffTeamMember,
    {
      id: entityId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    undefined,
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )

  if (!member) {
    return {
      title: defaultTitle,
      subtitle: entityId,
      status: t('staff.messageObjects.notFound'),
      statusColor: 'gray',
    }
  }

  const tags = Array.isArray(member.tags) ? member.tags : []
  const metadata: Record<string, string> = {}
  const teamLabel = t('staff.teamMembers.detail.fields.team')
  const userLabel = t('staff.teamMembers.detail.fields.user')
  const rolesLabel = t('staff.teamMembers.detail.fields.roles')

  if (member.teamId) {
    const team = await findOneWithDecryption(
      em,
      StaffTeam,
      {
        id: member.teamId,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        deletedAt: null,
      },
      undefined,
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    )
    if (team?.name) metadata[teamLabel] = team.name
  }

  if (member.userId) {
    const user = await findOneWithDecryption(
      em,
      User,
      { id: member.userId },
      undefined,
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    )
    if (user?.email) metadata[userLabel] = user.email
  }

  if (Array.isArray(member.roleIds) && member.roleIds.length > 0) {
    const roles = await findWithDecryption(
      em,
      StaffTeamRole,
      {
        id: { $in: member.roleIds },
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        deletedAt: null,
      },
      { orderBy: { name: 'ASC' } },
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    )
    const roleNames = roles
      .map((role) => role.name?.trim())
      .filter((name): name is string => Boolean(name && name.length > 0))
    if (roleNames.length > 0) metadata[rolesLabel] = roleNames.join(', ')
  }

  if (tags.length > 0) metadata.Tags = tags.slice(0, 5).join(', ')

  return {
    title: member.displayName,
    subtitle: member.description ?? entityId,
    status: member.isActive ? 'Active' : 'Inactive',
    statusColor: member.isActive ? 'green' : 'gray',
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  }
}

export async function loadStaffTeamRolePreview(
  entityId: string,
  ctx: PreviewContext,
): Promise<ObjectPreviewData> {
  const { t } = await resolveTranslations()
  const defaultTitle = t('staff.messageObjects.teamRole.title')

  if (!ctx.organizationId) {
    return { title: defaultTitle, subtitle: entityId }
  }

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager

  const role = await findOneWithDecryption(
    em,
    StaffTeamRole,
    {
      id: entityId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    undefined,
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )

  if (!role) {
    return {
      title: defaultTitle,
      subtitle: entityId,
      status: t('staff.messageObjects.notFound'),
      statusColor: 'gray',
    }
  }

  return {
    title: role.name,
    subtitle: role.description ?? undefined,
  }
}

export async function loadStaffAvailabilityPreview(
  entityId: string,
  ctx: PreviewContext,
): Promise<ObjectPreviewData> {
  const { t } = await resolveTranslations()
  const defaultTitle = t('staff.messageObjects.myAvailability.title')

  if (!ctx.organizationId) {
    return { title: defaultTitle, subtitle: entityId }
  }

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager

  const ruleSet = await findOneWithDecryption(
    em,
    PlannerAvailabilityRuleSet,
    {
      id: entityId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    undefined,
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )

  if (!ruleSet) {
    return { title: defaultTitle, subtitle: entityId }
  }

  return {
    title: ruleSet.name,
    subtitle: ruleSet.description ?? undefined,
  }
}
