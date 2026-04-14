import type { Kysely } from 'kysely'
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
  db: Kysely<any>,
  tenantId: string,
  roleId: string
): Promise<string[]> {
  const builder: any = db
  const userRoles = await builder
    .selectFrom('user_roles')
    .innerJoin('users', 'user_roles.user_id', 'users.id')
    .where('user_roles.role_id', '=', roleId)
    .where('user_roles.deleted_at', 'is', null)
    .where('users.deleted_at', 'is', null)
    .where('users.tenant_id', '=', tenantId)
    .select('users.id as user_id')
    .execute() as Array<{ user_id: string }>

  return userRoles.map((row) => row.user_id)
}

export async function getRecipientUserIdsForFeature(
  db: Kysely<any>,
  tenantId: string,
  requiredFeature: string
): Promise<string[]> {
  const userIdsSet = new Set<string>()
  const builder: any = db

  const userAcls = await builder
    .selectFrom('user_acls')
    .innerJoin('users', 'user_acls.user_id', 'users.id')
    .where('user_acls.tenant_id', '=', tenantId)
    .where('user_acls.deleted_at', 'is', null)
    .where('users.deleted_at', 'is', null)
    .where('users.tenant_id', '=', tenantId)
    .select([
      'users.id as user_id',
      'user_acls.features_json',
      'user_acls.is_super_admin',
    ])
    .execute() as AclRow[]

  collectUsersWithFeature(userIdsSet, userAcls, requiredFeature)

  const roleAcls = await builder
    .selectFrom('role_acls')
    .innerJoin('user_roles', 'role_acls.role_id', 'user_roles.role_id')
    .innerJoin('users', 'user_roles.user_id', 'users.id')
    .where('role_acls.tenant_id', '=', tenantId)
    .where('role_acls.deleted_at', 'is', null)
    .where('user_roles.deleted_at', 'is', null)
    .where('users.deleted_at', 'is', null)
    .where('users.tenant_id', '=', tenantId)
    .select([
      'users.id as user_id',
      'role_acls.features_json',
      'role_acls.is_super_admin',
    ])
    .execute() as AclRow[]

  collectUsersWithFeature(userIdsSet, roleAcls, requiredFeature)

  return Array.from(userIdsSet)
}
