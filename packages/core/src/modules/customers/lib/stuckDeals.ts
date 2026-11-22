import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'
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
export async function fetchStuckDealIds(
  em: EntityManager,
  organizationId: string,
  tenantId: string,
): Promise<string[]> {
  return fetchScopedStuckDealIds(em, [organizationId], tenantId)
}

export async function fetchScopedStuckDealIds(
  em: EntityManager,
  organizationIds: string[] | null,
  tenantId: string,
): Promise<string[]> {
  if (organizationIds?.length === 0) return []
  const db = resolveKyselyClient(em)
  if (!db) return []

  let transitions = db
    .selectFrom('customer_deal_stage_transitions')
    .select(['deal_id', 'organization_id'])
    .select((eb) => eb.fn.max('transitioned_at').as('last_transition'))
    .where('tenant_id', '=', tenantId)
    .where('deleted_at', 'is', null)
    .groupBy(['deal_id', 'organization_id'])
  if (organizationIds) transitions = transitions.where('organization_id', 'in', organizationIds)

  let deals = db
    .selectFrom('customer_deals as deal')
    .leftJoin(transitions.as('stage'), (join) => join
      .onRef('stage.deal_id', '=', 'deal.id')
      .onRef('stage.organization_id', '=', 'deal.organization_id'))
    .leftJoin('customer_settings as settings', (join) => join
      .onRef('settings.organization_id', '=', 'deal.organization_id')
      .onRef('settings.tenant_id', '=', 'deal.tenant_id'))
    .select('deal.id')
    .where('deal.tenant_id', '=', tenantId)
    .where('deal.deleted_at', 'is', null)
    .where(({ ref }) => sql<boolean>`
      COALESCE(${ref('stage.last_transition')}, ${ref('deal.created_at')}) <
        ${new Date()}::timestamptz - INTERVAL '24 hours' * CASE
          WHEN ${ref('settings.stuck_threshold_days')} > 0 THEN ${ref('settings.stuck_threshold_days')}
          ELSE ${STUCK_DEFAULT_THRESHOLD_DAYS}
        END
    `)
  if (organizationIds) deals = deals.where('deal.organization_id', 'in', organizationIds)

  const rows = await deals.execute()
  return rows.map((row) => row.id)
}
