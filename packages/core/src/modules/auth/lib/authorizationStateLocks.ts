import { LockMode } from '@mikro-orm/core'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { ApiKey } from '@open-mercato/core/modules/api_keys/data/entities'
import { Role, User } from '@open-mercato/core/modules/auth/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

function uniqueSortedIds(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0))).sort()
}

export async function lockAuthorizationApiKeyRows(
  em: EntityManager,
  apiKeyIds: readonly string[],
): Promise<ApiKey[]> {
  const locked: ApiKey[] = []
  for (const id of uniqueSortedIds(apiKeyIds)) {
    const apiKey = await findOneWithDecryption(
      em,
      ApiKey,
      { id } as FilterQuery<ApiKey>,
      { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
      { tenantId: null, organizationId: null },
    )
    if (apiKey) locked.push(apiKey)
  }
  return locked
}

export async function findApiKeyIdsReferencingRoles(
  em: EntityManager,
  roleIds: readonly string[],
): Promise<string[]> {
  const ids = uniqueSortedIds(roleIds)
  if (!ids.length) return []
  const apiKeys = await em.find(
    ApiKey,
    {
      deletedAt: null,
      $or: ids.map((roleId) => ({ rolesJson: { $contains: [roleId] } })),
    } as FilterQuery<ApiKey>,
    { orderBy: { id: 'ASC' } },
  )
  return uniqueSortedIds(apiKeys.map((apiKey) => String(apiKey.id)))
}

export async function lockApiKeysReferencingRoles(
  em: EntityManager,
  roleIds: readonly string[],
): Promise<ApiKey[]> {
  const apiKeyIds = await findApiKeyIdsReferencingRoles(em, roleIds)
  return lockAuthorizationApiKeyRows(em, apiKeyIds)
}

export async function lockAuthorizationRoleRows(
  em: EntityManager,
  roleIds: readonly string[],
): Promise<void> {
  for (const id of uniqueSortedIds(roleIds)) {
    await findOneWithDecryption(
      em,
      Role,
      { id, deletedAt: null } as FilterQuery<Role>,
      { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
      { tenantId: null, organizationId: null },
    )
  }
}

export async function lockAuthorizationUserRows(
  em: EntityManager,
  userIds: readonly string[],
): Promise<void> {
  for (const id of uniqueSortedIds(userIds)) {
    await findOneWithDecryption(
      em,
      User,
      { id, deletedAt: null } as FilterQuery<User>,
      { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
      { tenantId: null, organizationId: null },
    )
  }
}

export async function lockRoleWriterAuthorizationState(
  em: EntityManager,
  roleIds: readonly string[],
): Promise<void> {
  const ids = uniqueSortedIds(roleIds)
  if (!ids.length) return
  await lockApiKeysReferencingRoles(em, ids)
  await lockAuthorizationRoleRows(em, ids)
}
