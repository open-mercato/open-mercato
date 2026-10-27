import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

type SalesOrderOwnershipDb = {
  sales_orders: {
    id: string
    customer_entity_id: string | null
    tenant_id: string | null
    organization_id: string | null
    deleted_at: Date | null
  }
}

export type OrderOwnershipScope = { tenantId: string; organizationId: string }

function isMissingSalesOrdersTableError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const candidate = err as { code?: unknown; message?: unknown }
  return candidate.code === '42P01'
    || (typeof candidate.message === 'string' && candidate.message.includes('does not exist'))
}

/**
 * Cross-customer integrity guard shared by staff claim writes and registrations.
 *
 * When a record references both a customer and a sales order, the order MUST belong to
 * that customer. Skips silently when either side is absent, when the sales module/table
 * is not present, or when the referenced order carries no customer — those cases cannot
 * prove a mismatch. Throws only on a definite mismatch (both non-null and different),
 * which is the leak reproduced in UI QA (WQA-001 / REG-03).
 */
export async function assertOrderBelongsToCustomer(
  em: EntityManager,
  scope: OrderOwnershipScope,
  orderId: string | null | undefined,
  customerId: string | null | undefined,
): Promise<void> {
  if (!orderId || !customerId) return
  const db = em.fork().getKysely<SalesOrderOwnershipDb>()
  let row: { customer_entity_id: string | null } | undefined
  try {
    row = await db
      .selectFrom('sales_orders')
      .select('customer_entity_id')
      .where('id', '=', orderId)
      .where('tenant_id', '=', scope.tenantId)
      .where('organization_id', '=', scope.organizationId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()
  } catch (err) {
    if (isMissingSalesOrdersTableError(err)) return
    throw err
  }
  if (!row) return
  if (row.customer_entity_id && row.customer_entity_id !== customerId) {
    throw new CrudHttpError(400, { error: 'warranty_claims.errors.customerOrderMismatch' })
  }
}
