import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { User } from '@open-mercato/core/modules/auth/data/entities'

/**
 * Resolves display labels for a set of user ids, tenant/organization scoped.
 *
 * Used wherever the CRM attributes something to the colleague who did it — the
 * "Shared by {name}" badge on the Emails tab, and the per-message sender label
 * a teammate sees on a shared conversation. Best effort by design: a caller
 * renders a generic fallback for any id that resolves to no label, so a failed
 * lookup degrades the wording rather than the read.
 */
export async function resolveUserNames(
  em: EntityManager,
  tenantId: string,
  organizationId: string | null,
  userIds: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  const unique = Array.from(new Set(userIds.filter((id): id is string => typeof id === 'string' && !!id)))
  if (unique.length === 0) return names
  try {
    const users = (await findWithDecryption(
      em,
      User,
      { id: { $in: unique } } as never,
      undefined,
      { tenantId, organizationId },
    )) as Array<{ id: string; name?: string | null; email?: string | null }>
    for (const user of Array.isArray(users) ? users : []) {
      const label = user.name?.trim() || user.email?.trim() || null
      if (label) names.set(user.id, label)
    }
  } catch {
    /* best effort — callers fall back to a generic label without a name */
  }
  return names
}
