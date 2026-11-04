import type { EntityManager } from '@mikro-orm/postgresql'
import type { ApiKey } from '../data/entities'
import { UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

export function isSessionBoundApiKey(key: ApiKey): boolean {
  return Boolean(key.sessionToken || key.sessionUserId || key.sessionSecretEncrypted || key.opencodeSessionId)
}

export async function resolveApiKeyRoleIds(
  em: EntityManager,
  key: ApiKey,
  tenantId: string | null = key.tenantId ?? null,
): Promise<string[]> {
  const issuedRoleIds = Array.isArray(key.rolesJson)
    ? key.rolesJson.filter((roleId): roleId is string => typeof roleId === 'string' && roleId.length > 0)
    : []
  if (!isSessionBoundApiKey(key)) return issuedRoleIds
  const ownerId = key.sessionUserId?.trim()
  if (!ownerId || !tenantId || tenantId !== key.tenantId || !issuedRoleIds.length) return []

  const links = await findWithDecryption(
    em,
    UserRole,
    {
      user: { id: ownerId, tenantId, deletedAt: null },
      role: { id: { $in: issuedRoleIds }, tenantId, deletedAt: null },
      deletedAt: null,
    },
    { populate: ['role'] },
    { tenantId, organizationId: null },
  )
  const currentRoleIds = new Set(links.map((link) => typeof link.role === 'string' ? link.role : link.role.id))
  return issuedRoleIds.filter((roleId) => currentRoleIds.has(roleId))
}
