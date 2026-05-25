import type { EntityManager } from '@mikro-orm/postgresql'
import type { CustomerKysely } from './kysely'
import { resolveKyselyClient } from './kysely'

/**
 * Default number of days a deal can sit in a stage before it counts as "stuck".
 * Tenants can override by writing a row into `customer_settings.stuck_threshold_days`.
 */
export const STUCK_DEFAULT_THRESHOLD_DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Resolves the configured stuck-threshold for the tenant scope. Falls back to
 * `STUCK_DEFAULT_THRESHOLD_DAYS` when no setting row is present or the value is invalid.
 */
export async function fetchStuckThresholdDays(
  db: CustomerKysely,
  organizationId: string,
  tenantId: string,
): Promise<number> {
  const row = await db
    .selectFrom('customer_settings')
    .select(['stuck_threshold_days'])
    .where('organization_id', '=', organizationId)
    .where('tenant_id', '=', tenantId)
    .executeTakeFirst()
  const raw = row?.stuck_threshold_days
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : null
  if (value !== null && Number.isFinite(value) && value > 0) return value
  return STUCK_DEFAULT_THRESHOLD_DAYS
}

/**
 * Returns the set of deal IDs (in scope) that are currently considered "stuck":
 *  - deals whose last stage transition was earlier than (now - threshold), OR
 *  - deals that never transitioned but were created earlier than (now - threshold).
 *
 * The list endpoint and the lane-aggregate endpoint MUST share this query so the kanban
 * lane headers, lane counts, and the rendered cards agree on which deals count as stuck.
 */
export async function fetchStuckDealIds(
  em: EntityManager,
  organizationId: string,
  tenantId: string,
): Promise<string[]> {
  const db = resolveKyselyClient(em)
  if (!db) return []

  const threshold = await fetchStuckThresholdDays(db, organizationId, tenantId)
  const cutoff = new Date(Date.now() - threshold * DAY_MS)

  const oldTransitionRows = await db
    .selectFrom('customer_deal_stage_transitions')
    .select(['deal_id'])
    .select((eb) => eb.fn.max('transitioned_at').as('last_transition'))
    .where('organization_id', '=', organizationId)
    .where('tenant_id', '=', tenantId)
    .where('deleted_at', 'is', null)
    .groupBy('deal_id')
    .having((eb) => eb(eb.fn.max('transitioned_at'), '<', cutoff))
    .execute()

  const transitionedDealIds = await db
    .selectFrom('customer_deal_stage_transitions')
    .select(['deal_id'])
    .distinct()
    .where('organization_id', '=', organizationId)
    .where('tenant_id', '=', tenantId)
    .where('deleted_at', 'is', null)
    .execute()
  const transitionedSet = new Set(transitionedDealIds.map((r) => r.deal_id))

  const oldUntransitionedDeals = await db
    .selectFrom('customer_deals')
    .select(['id'])
    .where('organization_id', '=', organizationId)
    .where('tenant_id', '=', tenantId)
    .where('deleted_at', 'is', null)
    .where('created_at', '<', cutoff)
    .execute()

  const result = new Set<string>()
  oldTransitionRows.forEach((row) => result.add(row.deal_id))
  oldUntransitionedDeals.forEach((row) => {
    if (!transitionedSet.has(row.id)) result.add(row.id)
  })
  return Array.from(result)
}
