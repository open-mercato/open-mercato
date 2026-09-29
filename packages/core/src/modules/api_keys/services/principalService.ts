import type { FilterQuery } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { ApiKeyPrincipalService, PrincipalScope } from '@open-mercato/shared/lib/auth/principal-service'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ApiKey } from '../data/entities'

function normalizeIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return []
  return Array.from(new Set(ids
    .map((id) => typeof id === 'string' ? id.trim() : '')
    .filter(Boolean)))
}

export class DefaultApiKeyPrincipalService implements ApiKeyPrincipalService {
  constructor(private readonly em: EntityManager) {}

  async resolveAssignedRoleIds(apiKeyId: string, scope: PrincipalScope): Promise<string[]> {
    const apiKey = await findOneWithDecryption(
      this.em,
      ApiKey,
      {
        id: apiKeyId,
        tenantId: scope.tenantId,
        deletedAt: null,
        $or: [{ organizationId: null }, { organizationId: scope.organizationId }],
      } as FilterQuery<ApiKey>,
      { fields: ['rolesJson', 'expiresAt'] as const },
      scope,
    )
    if (!apiKey || (apiKey.expiresAt && apiKey.expiresAt.getTime() <= Date.now())) return []
    return normalizeIds(apiKey.rolesJson)
  }
}
