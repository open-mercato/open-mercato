import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { StaffTeamMember } from '../data/entities'

/**
 * Resolve the StaffTeamMember record for an authenticated user.
 * Returns null if the user has no linked staff member.
 */
export async function getStaffMemberByUserId(
  em: EntityManager,
  userId: string,
  tenantId: string | null,
  organizationId: string | null,
): Promise<StaffTeamMember | null> {
  return findOneWithDecryption(
    em,
    StaffTeamMember,
    { userId, deletedAt: null },
    undefined,
    { tenantId, organizationId },
  )
}
