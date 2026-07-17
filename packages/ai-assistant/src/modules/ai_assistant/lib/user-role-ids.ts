import type { EntityManager } from '@mikro-orm/postgresql'
import { UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

/**
 * Resolve a user's role ids for the given tenant.
 *
 * Single source for every AI-assistant surface that mints a role-carrying
 * API key (the mcp-key and session-key routes, the chat route's ephemeral
 * session keys, and the mcp:ensure-api-key CLI), so all of those keys
 * inherit exactly the same ACL for the same user.
 */
export async function getUserRoleIds(
  em: EntityManager,
  userId: string,
  tenantId: string | null,
): Promise<string[]> {
  if (!tenantId) return []
  const links = await findWithDecryption(
    em,
    UserRole,
    { user: userId, role: { tenantId } },
    { populate: ['role'] },
    { tenantId, organizationId: null },
  )
  const linkList = Array.isArray(links) ? links : []
  return linkList
    .map((link) => link.role?.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
}
