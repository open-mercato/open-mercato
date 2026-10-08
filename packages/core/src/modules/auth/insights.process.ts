import { isUuid } from '@open-mercato/shared/lib/causation/types'
import {
  defineProcessConfig,
  type ProcessActorDimensionContext,
} from '@open-mercato/shared/modules/insights/process'

type ActorRoleDatabase = {
  user_roles: { user_id: string; role_id: string; deleted_at: Date | null }
  roles: { id: string; tenant_id: string; deleted_at: Date | null }
  users: { id: string; tenant_id: string | null; deleted_at: Date | null }
}

/**
 * Roles of each actor for Process X-Ray breakdowns: the live role assignments of live users
 * and roles of the tenant (one query per batch of actors). Role ids only.
 */
export async function resolveActorRoles(ctx: ProcessActorDimensionContext, userIds: string[]): Promise<Record<string, string[]>> {
  const ids = Array.from(new Set(userIds.filter((id) => isUuid(id))))
  if (ids.length === 0) return {}
  const db = ctx.em.getKysely<ActorRoleDatabase>()
  const rows = await db
    .selectFrom('user_roles')
    .innerJoin('roles', 'roles.id', 'user_roles.role_id')
    .innerJoin('users', 'users.id', 'user_roles.user_id')
    .select(['user_roles.user_id', 'user_roles.role_id'])
    .where('user_roles.user_id', 'in', ids)
    .where('user_roles.deleted_at', 'is', null)
    .where('roles.deleted_at', 'is', null)
    .where('roles.tenant_id', '=', ctx.tenantId)
    .where('users.deleted_at', 'is', null)
    .where('users.tenant_id', '=', ctx.tenantId)
    .execute()
  const roles: Record<string, string[]> = {}
  for (const row of rows) {
    const list = roles[row.user_id] ?? []
    if (!list.includes(row.role_id)) list.push(row.role_id)
    roles[row.user_id] = list
  }
  return roles
}

export const processConfig = defineProcessConfig({
  version: 1,
  actorDimensions: [{ kind: 'role', resolve: resolveActorRoles }],
})

export default processConfig
