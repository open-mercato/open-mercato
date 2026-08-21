import type { EntityManager } from '@mikro-orm/postgresql'

// The previous implementation probed `information_schema.columns` on every
// first call via `em.getKysely()` to decide whether to add a `deletedAt: null`
// filter. When that probe ran inside an already-active MikroORM transaction it
// shared the transaction's connection — and any failure (including transient
// connection-pool state, an aborted TX from a sibling query, or pg returning
// 25P02) propagated back into the host transaction, poisoning every following
// query with `current transaction is aborted, commands ignored until end of
// transaction block`. That is what produced the standalone-CI failure burst
// (loadPersonCompanyLinks → 25P02 → customers.people.create → 500) and the
// sync_excel worker `failedCount: 1` regression.
//
// The `deleted_at` column on `customer_person_company_links` has been part of
// the committed module snapshot since `Migration20260415095203` (April 2026)
// and is referenced by `Migration20260417140000` (partial unique index uses
// `where deleted_at is null`). Any environment running these migrations
// already has the column. So the probe is no longer load-bearing — it only
// adds risk. We now unconditionally include `deletedAt: null` in the filter.
// If a downstream DB is genuinely un-migrated, the underlying `em.find` will
// surface the authentic `column "deleted_at" of relation
// "customer_person_company_links" does not exist` (pg 42703) pointing the
// operator at the real fix (`yarn db:migrate`).
//
// `customerPersonCompanyLinksSupportDeletedAt` and
// `warnMissingCustomerPersonCompanyLinksDeletedAt` are kept as exported
// no-op-equivalents so external callers (and the published @open-mercato/core
// API surface) don't break.

export async function customerPersonCompanyLinksSupportDeletedAt(_em: EntityManager): Promise<boolean> {
  return true
}

export function warnMissingCustomerPersonCompanyLinksDeletedAt(_source: string): void {
  // No-op: column is guaranteed present by Migration20260415095203 and the
  // module snapshot. Kept for backward-compatible exports.
}

export async function withActiveCustomerPersonCompanyLinkFilter<T extends Record<string, unknown>>(
  _em: EntityManager,
  where: T,
  _source: string,
): Promise<T & { deletedAt?: null }> {
  return { ...where, deletedAt: null }
}

/**
 * Drop soft-deleted link rows from a result set as a defense-in-depth fallback.
 * MikroORM has historically dropped `deletedAt: null` from the WHERE clause for
 * nullable date columns under certain configurations, so callers SHOULD apply this
 * after `findWithDecryption(...)` until the upstream query filter is verified to
 * fully cover all callers.
 */
export function filterActivePersonCompanyLinks<T extends { deletedAt?: Date | string | null | undefined }>(
  links: T[] | null | undefined,
): T[] {
  if (!Array.isArray(links)) return []
  return links.filter((entry) => entry?.deletedAt == null)
}

export type CustomerLinkTenantScope = {
  tenantId?: string | null
  organizationId?: string | null
}

/**
 * Bound a person↔company link lookup to the caller's tenant/organization.
 * `customer_person_company_links` carries `tenant_id`/`organization_id`
 * directly, so each scope column is added to the WHERE clause when present.
 * The people/companies list routes use this when resolving `excludeLinked*`
 * params so the lookup is bounded by tenant instead of scanning the whole link
 * table — `findWithDecryption` forwards the WHERE verbatim and treats the
 * tenant/org scope as decryption-only (#2736).
 */
export function withCustomerPersonCompanyLinkScope<T extends Record<string, unknown>>(
  where: T,
  scope: CustomerLinkTenantScope,
): T & { tenantId?: string; organizationId?: string } {
  const scoped: T & { tenantId?: string; organizationId?: string } = { ...where }
  if (scope.tenantId) scoped.tenantId = scope.tenantId
  if (scope.organizationId) scoped.organizationId = scope.organizationId
  return scoped
}

/**
 * Build a tenant/organization-scoped WHERE for deal↔person and deal↔company
 * link lookups. Those link tables carry no tenant columns, so the scope is
 * applied through the tenant-owned `deal` aggregate (#2736).
 */
export function withScopedCustomerDealLinkWhere(
  dealId: string,
  scope: CustomerLinkTenantScope,
): { deal: { id: string; tenantId?: string; organizationId?: string } } {
  const deal: { id: string; tenantId?: string; organizationId?: string } = { id: dealId }
  if (scope.tenantId) deal.tenantId = scope.tenantId
  if (scope.organizationId) deal.organizationId = scope.organizationId
  return { deal }
}
