import type { EntityManager } from '@mikro-orm/postgresql'
import { StaffTeamMember } from '../data/entities'

export type StaffTeamRecipientResolveInput = {
  organizationId: string
  tenantId: string
  teamId: string
  at?: Date
}

export type StaffTeamRecipient = {
  userId: string
  label?: string
}

export type StaffTeamMemberResolver = {
  resolveIncidentTeamRecipients(input: StaffTeamRecipientResolveInput): Promise<StaffTeamRecipient[]>
}

export function createStaffTeamMemberResolver(em: EntityManager): StaffTeamMemberResolver {
  return {
    async resolveIncidentTeamRecipients(input) {
      const members = await em.find(
        StaffTeamMember,
        {
          organizationId: input.organizationId,
          tenantId: input.tenantId,
          teamId: input.teamId,
          isActive: true,
          deletedAt: null,
        },
        { orderBy: { displayName: 'asc' } },
      )

      return members.flatMap((member) => {
        const userId = member.userId?.trim()
        if (!userId) return []
        const label = member.displayName?.trim()
        return [{ userId, ...(label ? { label } : {}) }]
      })
    },
  }
}
