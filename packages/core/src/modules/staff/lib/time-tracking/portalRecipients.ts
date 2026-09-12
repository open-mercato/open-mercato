import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('staff').child({ component: 'time-tracking/portal-recipients' })

/**
 * EP-50. The customer-user side of the portal contract, expressed as table and
 * column **names** rather than imports.
 *
 * Staff is slated for extraction into `@open-mercato/staff`, so it may not take a
 * static dependency on `customer_accounts`; `requires` in `index.ts` stays
 * `['planner', 'resources']`. A Kysely query against the string
 * `'customer_users'` reads the mapping without an import edge, exactly the way
 * `warranty_claims/commands/claims.ts` does — and if the table is absent because
 * the module is not installed, the query throws and this returns an empty list,
 * which every caller treats as "no portal audience".
 *
 * `customer_users.customer_entity_id` is the FK into `customers:customer_entity`,
 * which is the same id `staff_time_reports.customer_id` holds (EP-44 declares that
 * link). That equality is the whole ownership model: a portal user reaches a
 * report when, and only when, their own `customer_entity_id` matches the report's
 * `customer_id` inside the same tenant and organization.
 */

type CustomerUsersDb = {
  customer_users: {
    id: string
    tenant_id: string | null
    organization_id: string | null
    customer_entity_id: string | null
    is_active: boolean
    deleted_at: Date | null
  }
}

export type PortalRecipientScope = {
  tenantId: string
  organizationId: string
  customerId: string
}

/** A broadcast fan-out, not a mailing list — a customer with more portal users than this gets a truncated audience rather than an unbounded query. */
export const MAX_PORTAL_RECIPIENTS = 100

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export async function resolvePortalRecipientUserIds(
  em: EntityManager,
  scope: PortalRecipientScope,
): Promise<string[]> {
  if (!isNonEmpty(scope.tenantId) || !isNonEmpty(scope.organizationId) || !isNonEmpty(scope.customerId)) {
    return []
  }
  try {
    const db = em.getKysely<CustomerUsersDb>()
    const rows = await db
      .selectFrom('customer_users')
      .select('id')
      .where('tenant_id', '=', scope.tenantId)
      .where('organization_id', '=', scope.organizationId)
      .where('customer_entity_id', '=', scope.customerId)
      .where('is_active', '=', true)
      .where('deleted_at', 'is', null)
      .limit(MAX_PORTAL_RECIPIENTS)
      .execute()
    return rows.map((row) => row.id).filter(isNonEmpty)
  } catch (err) {
    logger.warn('Could not resolve portal recipients for a time-tracking customer', {
      customerId: scope.customerId,
      err,
    })
    return []
  }
}
