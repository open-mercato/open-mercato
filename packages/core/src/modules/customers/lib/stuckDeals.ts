import { sql } from 'kysely'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CustomerKysely } from './kysely'
import { resolveKyselyClient } from './kysely'

/**
 * Default number of days a deal can sit in a stage before it counts as "stuck".
 * Tenants can override by writing a row into `customer_settings.stuck_threshold_days`.
 */
export const STUCK_DEFAULT_THRESHOLD_DAYS = 14

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
export function fetchStuckDealIds(
  em: EntityManager,
  organizationId: string,
  tenantId: string,
): Promise<string[]> {
  return fetchScopedStuckDealIds(em, [organizationId], tenantId)
}

export async function fetchScopedStuckDealIds(
  em: EntityManager,
  organizationIds: string[],
  tenantId: string,
): Promise<string[]> {
  const db = resolveKyselyClient(em)
  if (!db || !organizationIds.length) return []

  const latestTransitions = db
    .selectFrom('customer_deal_stage_transitions')
    .select(({ fn }) => ['deal_id', 'organization_id', fn.max('transitioned_at').as('transitioned_at')])
    .where('tenant_id', '=', tenantId)
    .where('organization_id', 'in', organizationIds)
    .where('deleted_at', 'is', null)
    .groupBy(['deal_id', 'organization_id'])
    .as('latest_transition')

  const rows = await db
    .selectFrom('customer_deals as deal')
    .leftJoin(latestTransitions, (join) => join
      .onRef('latest_transition.deal_id', '=', 'deal.id')
      .onRef('latest_transition.organization_id', '=', 'deal.organization_id'))
    .leftJoin('customer_settings as settings', (join) => join
      .onRef('settings.tenant_id', '=', 'deal.tenant_id')
      .onRef('settings.organization_id', '=', 'deal.organization_id'))
    .select('deal.id')
    .where('deal.tenant_id', '=', tenantId)
    .where('deal.organization_id', 'in', organizationIds)
    .where('deal.deleted_at', 'is', null)
    .where(
      sql<Date>`CASE WHEN latest_transition.deal_id IS NULL THEN deal.created_at ELSE latest_transition.transitioned_at END`,
      '<',
      sql<Date>`${new Date()}::timestamptz - INTERVAL '24 hours' * (
        CASE WHEN settings.stuck_threshold_days > 0 THEN settings.stuck_threshold_days ELSE ${STUCK_DEFAULT_THRESHOLD_DAYS} END
      )`,
    )
    .execute()

  return rows.map(({ id }) => id)
}
