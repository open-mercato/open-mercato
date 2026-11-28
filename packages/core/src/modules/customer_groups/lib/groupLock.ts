import type { EntityManager } from '@mikro-orm/core'

export async function lockCustomerGroup(
  em: EntityManager,
  tenantId: string,
  groupId: string,
): Promise<{ deleted_at: Date | null } | undefined> {
  const [row] = await lockCustomerGroups(em, tenantId, [groupId])
  return row
}

export async function lockCustomerGroups(
  em: EntityManager,
  tenantId: string,
  groupIds: readonly string[],
): Promise<Array<{ deleted_at: Date | null }>> {
  const placeholders = groupIds.map(() => '?').join(', ')
  return em.getConnection('write').execute(
    `select deleted_at from customer_groups where tenant_id = ? and id in (${placeholders}) order by id for update`,
    [tenantId, ...groupIds],
    'all',
    em.getTransactionContext(),
  ) as Promise<Array<{ deleted_at: Date | null }>>
}

export async function lockCustomerGroupMembership(
  em: EntityManager,
  tenantId: string,
  id: string,
): Promise<{ group_id: string; customer_id: string; deleted_at: Date | null } | undefined> {
  const rows = await em.getConnection('write').execute(
    'select group_id, customer_id, deleted_at from customer_group_memberships where tenant_id = ? and id = ? for update',
    [tenantId, id],
    'all',
    em.getTransactionContext(),
  ) as Array<{ group_id: string; customer_id: string; deleted_at: Date | null }>
  return rows[0]
}
