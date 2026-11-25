import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { StaffTeamMember } from '../data/entities'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Resolve the StaffTeamMember record for an authenticated user.
 * Returns null if the user has no linked staff member.
 *
 * `staff_team_members.user_id` is a uuid column, so a principal id that is not a
 * uuid (an API key's `api_key:<id>` subject) cannot belong to a staff member and
 * resolves to null without querying. An empty tenant or organization id (the
 * enricher/interceptor context sentinel for "no organization in scope") is read
 * as null, never as an id.
 */
export async function getStaffMemberByUserId(
  em: EntityManager,
  userId: string,
  tenantId: string | null,
  organizationId: string | null,
): Promise<StaffTeamMember | null> {
  if (typeof userId !== 'string' || !UUID_PATTERN.test(userId)) return null
  return findOneWithDecryption(
    em,
    StaffTeamMember,
    { userId, deletedAt: null },
    undefined,
    { tenantId: tenantId || null, organizationId: organizationId || null },
  )
}
