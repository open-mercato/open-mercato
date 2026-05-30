import type { Kysely } from 'kysely'

/**
 * Narrow Kysely schema for the customers-module tables used by the kanban helpers
 * (`stuckDeals`, `enrichers`). Defining the schema locally keeps the queries strongly
 * typed without forcing a project-wide DB schema declaration. Add columns/tables here
 * when new customer-module queries need typed access.
 */
export interface CustomerKyselyDb {
  customer_settings: {
    organization_id: string
    tenant_id: string
    stuck_threshold_days: number | string | null
  }
  customer_deals: {
    id: string
    organization_id: string
    tenant_id: string
    deleted_at: Date | string | null
    created_at: Date | string | null
  }
  customer_deal_stage_transitions: {
    deal_id: string
    organization_id: string
    tenant_id: string
    deleted_at: Date | string | null
    transitioned_at: Date | string | null
  }
  customer_interactions: {
    deal_id: string | null
    entity_id: string | null
    organization_id: string
    tenant_id: string
    deleted_at: Date | string | null
    status: string | null
    interaction_type: string | null
    visibility: string | null
    author_user_id: string | null
  }
  /**
   * Read-only projection of the communication_channels-owned table. Declared
   * here (rather than coupling to that module's types) so the email-card
   * enricher can resolve `channel_metadata` for linked interactions with full
   * type-safety instead of an `as any` escape hatch.
   */
  message_channel_links: {
    id: string
    channel_metadata: unknown
    organization_id: string | null
    tenant_id: string
  }
}

export type CustomerKysely = Kysely<CustomerKyselyDb>

/**
 * Narrows an EntityManager-like value to a MikroORM v7 PG EntityManager and returns its
 * Kysely client, or `null` when the value doesn't expose `getKysely`.
 *
 * MikroORM v7's `@mikro-orm/postgresql` EntityManager ships `getKysely<TDb>()`, but the
 * shared `EnricherContext` types `em` as `unknown` to keep the contract DB-agnostic. The
 * kanban helpers (`stuckDeals`, `enrichers`) both need the typed client — this helper
 * centralizes the runtime check so neither call site has to repeat `(em as any).getKysely`.
 *
 * Returns `null` (rather than throwing) on purpose: callers fall back to a sensible default
 * (empty stuck-id list, un-enriched records) when the env doesn't have Kysely available
 * (e.g. unit tests with a stub EntityManager).
 */
export function resolveKyselyClient<TDb = CustomerKyselyDb>(em: unknown): Kysely<TDb> | null {
  if (em == null || typeof em !== 'object') return null
  const candidate = (em as { getKysely?: unknown }).getKysely
  if (typeof candidate !== 'function') return null
  const db = (candidate as () => unknown).call(em)
  if (db == null) return null
  return db as Kysely<TDb>
}
