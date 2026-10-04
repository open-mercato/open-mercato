import { LockMode } from '@mikro-orm/core'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { ApiKey } from '@open-mercato/core/modules/api_keys/data/entities'
import { Role, RoleAcl, User, UserAcl, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { lockOrganizationHierarchyForTenant } from '@open-mercato/core/modules/directory/lib/hierarchy'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

function uniqueSortedIds(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0))).sort()
}

function relationId(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value
  if (!value || typeof value !== 'object') return null
  const id = (value as { id?: unknown }).id
  return typeof id === 'string' && id.length > 0 ? id : null
}

export type AuthorizationStateLockTargets = {
  apiKeyIds?: readonly string[]
  userIds?: readonly string[]
  roleIds?: readonly string[]
  tenantIds?: readonly string[]
}

type AuthorizationStateLockLease = {
  apiKeyIds: ReadonlySet<string>
  userIds: ReadonlySet<string>
  roleIds: ReadonlySet<string>
  tenantIds: ReadonlySet<string>
}

const replayLockLeases = new WeakMap<object, AuthorizationStateLockLease>()

function assertLeaseContains(
  lease: AuthorizationStateLockLease,
  targets: AuthorizationStateLockTargets,
): void {
  const requested = {
    apiKeyIds: uniqueSortedIds(targets.apiKeyIds ?? []),
    userIds: uniqueSortedIds(targets.userIds ?? []),
    roleIds: uniqueSortedIds(targets.roleIds ?? []),
    tenantIds: uniqueSortedIds(targets.tenantIds ?? []),
  }
  for (const [kind, ids] of Object.entries(requested) as Array<
    [keyof AuthorizationStateLockLease, string[]]
  >) {
    for (const id of ids) {
      if (!lease[kind].has(id)) {
        throw new Error(`[internal] Authorization-state lock footprint was extended after it was sealed (${kind}:${id})`)
      }
    }
  }
}

function userRoleIdentity(link: UserRole): string | null {
  const userId = relationId(link.user)
  const roleId = relationId(link.role)
  return userId && roleId ? `${userId}:${roleId}` : null
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  const canonicalLeft = uniqueSortedIds(left)
  const canonicalRight = uniqueSortedIds(right)
  return canonicalLeft.length === canonicalRight.length
    && canonicalLeft.every((value, index) => value === canonicalRight[index])
}

function authorizationStateDrift(): CrudHttpError {
  return new CrudHttpError(409, {
    error: '[internal] Authorization state changed while acquiring its lock footprint',
  })
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
      { id } as FilterQuery<Role>,
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
      { id } as FilterQuery<User>,
      { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
      { tenantId: null, organizationId: null },
    )
  }
}

export async function lockRoleWriterAuthorizationState(
  em: EntityManager,
  roleIds: readonly string[],
): Promise<void> {
  await lockRoleAclWriterAuthorizationState(em, roleIds)
}

export async function lockAuthorizationState(
  em: EntityManager,
  targets: AuthorizationStateLockTargets,
  options: { sealReplayFootprint?: boolean } = {},
): Promise<void> {
  const existingLease = replayLockLeases.get(em as object)
  if (existingLease) {
    assertLeaseContains(existingLease, targets)
    return
  }

  const apiKeyIds = uniqueSortedIds(targets.apiKeyIds ?? [])
  const userIds = uniqueSortedIds(targets.userIds ?? [])
  const explicitRoleIds = uniqueSortedIds(targets.roleIds ?? [])
  const tenantIds = uniqueSortedIds(targets.tenantIds ?? [])
  const explicitApiKeys = apiKeyIds.length
    ? await findWithDecryption(
        em,
        ApiKey,
        { id: { $in: apiKeyIds } as unknown } as FilterQuery<ApiKey>,
        { orderBy: { id: 'ASC' } },
        { tenantId: null, organizationId: null },
      )
    : []
  const explicitApiKeyRoleIds = uniqueSortedIds(explicitApiKeys.flatMap((apiKey) => (
    Array.isArray(apiKey.rolesJson) ? apiKey.rolesJson : []
  )))
  const discoveredBeforeLocks = userIds.length
    ? await findWithDecryption(
        em,
        UserRole,
        { user: { $in: userIds } as unknown } as FilterQuery<UserRole>,
        { orderBy: { id: 'ASC' } },
        { tenantId: null, organizationId: null },
      )
    : []
  const roleIdsBeforeLocks = uniqueSortedIds([
    ...explicitRoleIds,
    ...explicitApiKeyRoleIds,
    ...discoveredBeforeLocks.flatMap((link) => {
      const id = relationId(link.role)
      return id ? [id] : []
    }),
  ])
  const referencingApiKeyIds = await findApiKeyIdsReferencingRoles(em, roleIdsBeforeLocks)
  const lockedApiKeys = await lockAuthorizationApiKeyRows(em, [
    ...apiKeyIds,
    ...referencingApiKeyIds,
  ])

  for (const apiKey of lockedApiKeys) {
    const id = String(apiKey.id)
    if (!apiKeyIds.includes(id)) continue
    const before = explicitApiKeys.find((candidate) => String(candidate.id) === id)
    const beforeRoles = Array.isArray(before?.rolesJson) ? before.rolesJson : []
    const lockedRoles = Array.isArray(apiKey.rolesJson) ? apiKey.rolesJson : []
    if (!sameIds(beforeRoles, lockedRoles)) {
      throw authorizationStateDrift()
    }
  }

  await lockAuthorizationUserRows(em, userIds)

  const stableUserRoles = userIds.length
    ? await findWithDecryption(
        em,
        UserRole,
        { user: { $in: userIds } as unknown } as FilterQuery<UserRole>,
        { orderBy: { id: 'ASC' }, refresh: true },
        { tenantId: null, organizationId: null },
      )
    : []
  const discoveredIdentities = discoveredBeforeLocks
    .map(userRoleIdentity)
    .filter((value): value is string => value !== null)
  const stableIdentities = stableUserRoles
    .map(userRoleIdentity)
    .filter((value): value is string => value !== null)
  if (!sameIds(discoveredIdentities, stableIdentities)) {
    throw authorizationStateDrift()
  }
  const roleIds = uniqueSortedIds([
    ...roleIdsBeforeLocks,
    ...stableUserRoles.flatMap((link) => {
      const id = relationId(link.role)
      return id ? [id] : []
    }),
  ])

  await lockAuthorizationRoleRows(em, roleIds)

  for (const tenantId of tenantIds) {
    await lockOrganizationHierarchyForTenant(em, tenantId)
  }

  if (userIds.length) {
    await findWithDecryption(
      em,
      UserRole,
      { user: { $in: userIds } as unknown } as FilterQuery<UserRole>,
      { lockMode: LockMode.PESSIMISTIC_WRITE, orderBy: { id: 'ASC' }, refresh: true },
      { tenantId: null, organizationId: null },
    )
  }

  if (userIds.length) {
    await findWithDecryption(
      em,
      UserAcl,
      { user: { $in: userIds } as unknown } as FilterQuery<UserAcl>,
      { lockMode: LockMode.PESSIMISTIC_WRITE, orderBy: { id: 'ASC' }, refresh: true },
      { tenantId: null, organizationId: null },
    )
  }
  if (roleIds.length) {
    await findWithDecryption(
      em,
      RoleAcl,
      { role: { $in: roleIds } as unknown } as FilterQuery<RoleAcl>,
      { lockMode: LockMode.PESSIMISTIC_WRITE, orderBy: { id: 'ASC' }, refresh: true },
      { tenantId: null, organizationId: null },
    )
  }

  if (options.sealReplayFootprint) {
    replayLockLeases.set(em as object, {
      apiKeyIds: new Set(apiKeyIds),
      userIds: new Set(userIds),
      roleIds: new Set(roleIds),
      tenantIds: new Set(tenantIds),
    })
  }
}

export async function lockUserRoleWriterAuthorizationState(
  em: EntityManager,
  targets: { userIds: readonly string[]; roleIds: readonly string[] },
): Promise<void> {
  await lockAuthorizationState(em, targets)
}

export async function lockUserAclWriterAuthorizationState(
  em: EntityManager,
  userIds: readonly string[],
): Promise<void> {
  await lockAuthorizationState(em, { userIds })
}

export async function lockRoleAclWriterAuthorizationState(
  em: EntityManager,
  roleIds: readonly string[],
): Promise<void> {
  await lockAuthorizationState(em, { roleIds })
}
