import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { StaffTeamMember } from '../data/entities'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

/**
 * Every staff member linked to the user inside one tenant, optionally narrowed to
 * one organization.
 *
 * `StaffTeamMember` is organization-scoped, so a user who is staff in two
 * organizations of the same tenant has two rows. The lookup is always bound to
 * the trusted tenant (a missing tenant resolves to no member, never to a
 * cross-tenant search) and to the organization when one is given.
 *
 * `staff_team_members.user_id` is a uuid column, so a principal id that is not a
 * uuid (an API key's `api_key:<id>` subject) cannot belong to a staff member and
 * resolves to an empty list without querying. An empty tenant or organization id
 * (the enricher/interceptor context sentinel for "no organization in scope") is
 * read as missing, never as an id.
 */
export async function getStaffMembersByUserId(
  em: EntityManager,
  userId: string,
  tenantId: string | null,
  organizationId: string | null,
): Promise<StaffTeamMember[]> {
  if (!isUuid(userId)) return []
  const tenant = tenantId || null
  if (!isUuid(tenant)) return []
  const organization = organizationId || null
  if (organization !== null && !isUuid(organization)) return []
  return findWithDecryption(
    em,
    StaffTeamMember,
    organization
      ? { userId, tenantId: tenant, organizationId: organization, deletedAt: null }
      : { userId, tenantId: tenant, deletedAt: null },
    { orderBy: { organizationId: 'asc' } },
    { tenantId: tenant, organizationId: organization },
  )
}

/**
 * Resolve the single StaffTeamMember record for an authenticated user in the
 * given tenant and organization. Returns null if the user has no linked staff
 * member there.
 *
 * Without an organization the answer is only defined when the user is staff in
 * exactly one organization of the tenant. A user with memberships in several
 * organizations resolves to null instead of an arbitrary one of them, so a caller
 * can never act as, or scope a query to, the wrong staff record. Callers that
 * serve a multi-organization view use `getStaffMembersByUserId` instead.
 */
export async function getStaffMemberByUserId(
  em: EntityManager,
  userId: string,
  tenantId: string | null,
  organizationId: string | null,
): Promise<StaffTeamMember | null> {
  const members = await getStaffMembersByUserId(em, userId, tenantId, organizationId)
  return members.length === 1 ? members[0] : null
}
