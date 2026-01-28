import type { Knex } from 'knex'
import { hasFeature } from '@open-mercato/shared/security/features'

interface AclRow {
  user_id: string
  features_json: unknown
  is_super_admin: boolean
}

function normalizeFeatures(features: unknown): string[] | undefined {
  if (!Array.isArray(features)) return undefined
  const normalized = features.filter((feature): feature is string => typeof feature === 'string')
  return normalized.length ? normalized : undefined
}

/**
 * Extract user IDs from ACL rows that have the required feature or are super admins.
 */
function collectUsersWithFeature(
  userIdsSet: Set<string>,
  rows: AclRow[],
  requiredFeature: string
): void {
  for (const row of rows) {
    if (row.is_super_admin) {
      userIdsSet.add(row.user_id)
      continue
    }

    const features = normalizeFeatures(row.features_json)
    if (features && hasFeature(features, requiredFeature)) {
      userIdsSet.add(row.user_id)
    }
  }
}

export async function getRecipientUserIdsForRole(
  knex: Knex,
  tenantId: string,
  roleId: string
): Promise<string[]> {
  const userRoles = await knex('user_roles')
    .join('users', 'user_roles.user_id', 'users.id')
    .where('user_roles.role_id', roleId)
    .whereNull('user_roles.deleted_at')
    .whereNull('users.deleted_at')
    .where('users.tenant_id', tenantId)
    .select('users.id as user_id')

  return userRoles.map((row: { user_id: string }) => row.user_id)
}

export async function getRecipientUserIdsForFeature(
  knex: Knex,
  tenantId: string,
  requiredFeature: string
): Promise<string[]> {
  const userIdsSet = new Set<string>()

  const userAcls = await knex('user_acls')
    .join('users', 'user_acls.user_id', 'users.id')
    .where('user_acls.tenant_id', tenantId)
    .whereNull('user_acls.deleted_at')
    .whereNull('users.deleted_at')
    .where('users.tenant_id', tenantId)
    .select('users.id as user_id', 'user_acls.features_json', 'user_acls.is_super_admin')

  collectUsersWithFeature(userIdsSet, userAcls, requiredFeature)

  const roleAcls = await knex('role_acls')
    .join('user_roles', 'role_acls.role_id', 'user_roles.role_id')
    .join('users', 'user_roles.user_id', 'users.id')
    .where('role_acls.tenant_id', tenantId)
    .whereNull('role_acls.deleted_at')
    .whereNull('user_roles.deleted_at')
    .whereNull('users.deleted_at')
    .where('users.tenant_id', tenantId)
    .select('users.id as user_id', 'role_acls.features_json', 'role_acls.is_super_admin')

  collectUsersWithFeature(userIdsSet, roleAcls, requiredFeature)

  return Array.from(userIdsSet)
}
