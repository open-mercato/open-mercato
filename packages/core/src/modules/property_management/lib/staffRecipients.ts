import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { BuildingManager } from '../data/entities'
import { MANAGE_ALL_BUILDINGS_FEATURE } from './buildingAccess'
import type { Scope } from './productUse'

const RBAC_CHECK_BATCH = 10

type RbacLike = {
  userHasAllFeatures: (
    userId: string,
    features: string[],
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<boolean>
}

type AclRow = { user_id: string; features_json: unknown; is_super_admin: boolean | null }

export type StaffAudience = 'building' | 'administrators'

export type StaffRecipientInput = {
  container: AwilixContainer
  em: EntityManager
  scope: Scope
  buildingId: string | null
  audience?: StaffAudience
}

const SCOPED_USER_SQL = 'users.deleted_at is null and users.tenant_id = ? and (users.organization_id = ? or users.organization_id is null)'

function resolveRbac(container: AwilixContainer): RbacLike | null {
  try {
    return container.resolve('rbacService') as RbacLike
  } catch {
    return null
  }
}

function grantedFeaturesOf(value: unknown): string[] {
  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      return []
    }
  }
  return Array.isArray(parsed) ? parsed.filter((feature): feature is string => typeof feature === 'string') : []
}

function grantsFeature(row: AclRow, feature: string): boolean {
  return authorizeFeatures([feature], { grantedFeatures: grantedFeaturesOf(row.features_json), unrestricted: row.is_super_admin === true })
}

export async function findFeatureCandidates(em: EntityManager, scope: Scope, feature: string): Promise<string[]> {
  const connection = em.getConnection()
  const userAcls = await connection.execute<AclRow[]>(
    `select users.id as user_id, user_acls.features_json, user_acls.is_super_admin
       from user_acls
       inner join users on users.id = user_acls.user_id
      where user_acls.tenant_id = ?
        and user_acls.deleted_at is null
        and ${SCOPED_USER_SQL}`,
    [scope.tenantId, scope.tenantId, scope.organizationId],
    'all',
    em.getTransactionContext(),
  )
  const roleAcls = await connection.execute<AclRow[]>(
    `select users.id as user_id, role_acls.features_json, role_acls.is_super_admin
       from role_acls
       inner join roles on roles.id = role_acls.role_id
       inner join user_roles on user_roles.role_id = role_acls.role_id
       inner join users on users.id = user_roles.user_id
      where role_acls.tenant_id = ?
        and role_acls.deleted_at is null
        and roles.deleted_at is null
        and roles.tenant_id = ?
        and user_roles.deleted_at is null
        and ${SCOPED_USER_SQL}`,
    [scope.tenantId, scope.tenantId, scope.tenantId, scope.organizationId],
    'all',
    em.getTransactionContext(),
  )
  const candidates = new Set<string>()
  for (const row of [...userAcls, ...roleAcls]) {
    if (grantsFeature(row, feature)) candidates.add(String(row.user_id))
  }
  return Array.from(candidates).sort((left, right) => left.localeCompare(right))
}

export async function resolveManageAllHolders(
  container: AwilixContainer,
  em: EntityManager,
  scope: Scope,
): Promise<string[]> {
  const rbac = resolveRbac(container)
  if (!rbac) return []
  const candidates = await findFeatureCandidates(em, scope, MANAGE_ALL_BUILDINGS_FEATURE)
  const holders: string[] = []
  for (let offset = 0; offset < candidates.length; offset += RBAC_CHECK_BATCH) {
    const batch = candidates.slice(offset, offset + RBAC_CHECK_BATCH)
    const allowed = await Promise.all(
      batch.map((userId) =>
        rbac.userHasAllFeatures(userId, [MANAGE_ALL_BUILDINGS_FEATURE], { tenantId: scope.tenantId, organizationId: scope.organizationId }),
      ),
    )
    batch.forEach((userId, index) => {
      if (allowed[index]) holders.push(userId)
    })
  }
  return holders
}

export async function resolveStaffRecipients(input: StaffRecipientInput): Promise<string[]> {
  const { container, em, scope, buildingId } = input
  const audience = input.audience ?? 'building'
  const recipients = new Set<string>()
  if (audience === 'building' && buildingId) {
    const managers = await findWithDecryption(em, BuildingManager, { ...scope, buildingId }, undefined, scope)
    const managerIds = Array.from(new Set(managers.map((manager) => manager.userId)))
    const activeUsers = managerIds.length
      ? await findWithDecryption(
          em,
          User,
          { id: { $in: managerIds }, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
          undefined,
          scope,
        )
      : []
    for (const user of activeUsers) recipients.add(user.id)
  }
  for (const holder of await resolveManageAllHolders(container, em, scope)) recipients.add(holder)
  return Array.from(recipients).sort((left, right) => left.localeCompare(right))
}
