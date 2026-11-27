import type { EntityManager } from '@mikro-orm/core'

export async function lockCustomerGroup(
  em: EntityManager,
  tenantId: string,
  groupId: string,
): Promise<{ deleted_at: Date | null } | undefined> {
  const rows = await em.getConnection('write').execute(
    'select deleted_at from customer_groups where tenant_id = ? and id = ? for update',
    [tenantId, groupId],
    'all',
    em.getTransactionContext(),
  ) as Array<{ deleted_at: Date | null }>
  return rows[0]
}
