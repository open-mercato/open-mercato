import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { StaffTeamMember } from '../data/entities'

export type StaffMemberSchedulingRef = {
  userId: string
  staffMemberId: string
  availabilityRuleSetId: string | null
  displayName: string
}

export interface StaffMemberDirectory {
  listActiveSchedulingRefs(params: {
    userIds: string[]
    tenantId: string
    organizationId: string
  }): Promise<StaffMemberSchedulingRef[]>
}

export class DefaultStaffMemberDirectory implements StaffMemberDirectory {
  constructor(private readonly em: EntityManager) {}

  async listActiveSchedulingRefs(params: {
    userIds: string[]
    tenantId: string
    organizationId: string
  }): Promise<StaffMemberSchedulingRef[]> {
    if (params.userIds.length === 0) return []
    const rows = await findWithDecryption(
      this.em,
      StaffTeamMember,
      {
        userId: { $in: params.userIds },
        tenantId: params.tenantId,
        organizationId: params.organizationId,
        isActive: true,
        deletedAt: null,
      },
      { orderBy: { displayName: 'asc', id: 'asc' } },
      { tenantId: params.tenantId, organizationId: params.organizationId },
    )
    return rows.flatMap((row) => row.userId ? [{
      userId: row.userId,
      staffMemberId: row.id,
      availabilityRuleSetId: row.availabilityRuleSetId ?? null,
      displayName: row.displayName,
    }] : [])
  }
}
