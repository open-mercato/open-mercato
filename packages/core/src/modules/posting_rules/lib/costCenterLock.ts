import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CostCenter } from '../data/entities'

/**
 * Re-reads a live cost centre row inside the caller's open transaction with a
 * row lock, so deleting a cost centre and creating/updating a rule that points
 * at it cannot interleave. Delete takes `PESSIMISTIC_WRITE` (`for update`)
 * before it checks for referencing rules; rule create/update takes
 * `PESSIMISTIC_READ` (`for share`) before it writes the reference. Both lock
 * only this one row and take no other row lock first, so the two paths
 * serialize on it without a lock-order deadlock: either the rule commits
 * first and the delete sees the reference, or the delete commits first and the
 * rule write sees `deleted_at` set. `refresh: true` makes the read hit the
 * database even when the row is already in the identity map.
 */
export async function lockLiveCostCenter(
  em: EntityManager,
  costCenterId: string,
  scope: { organizationId: string; tenantId: string },
  lockMode: LockMode.PESSIMISTIC_WRITE | LockMode.PESSIMISTIC_READ,
): Promise<CostCenter | null> {
  return em.findOne(
    CostCenter,
    { id: costCenterId, organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null },
    { lockMode, refresh: true },
  )
}
