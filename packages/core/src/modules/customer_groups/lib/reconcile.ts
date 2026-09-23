import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerGroup } from '../data/entities'

// Step 1.10 — reconciliation scan/adopt logic shared by the CLI
// (`customer_groups reconcile`) and `GET /api/customer-groups/reconcile`.
//
// `catalog`/`sales` are read here purely as data access (raw SQL against their
// known table/column names) — never as a module import — per root AGENTS.md
// "Never create direct ORM relationships between modules" and the "FK-id +
// snapshot" coupling pattern in `packages/core/AGENTS.md` § Cross-Module
// Coupling. Table names below are taken directly from each module's
// `data/entities.ts` `@Entity({ tableName: ... })`:
// - `catalog/data/entities.ts` — the `CatalogProductPrice` class maps to table
//   `catalog_product_variant_prices` (NOT `catalog_product_prices` — the class
//   name and the table name diverge in that module).
// - `sales/data/entities.ts` — `SalesTaxRate` maps to table `sales_tax_rates`.
const CATALOG_PRICE_TABLE = 'catalog_product_variant_prices'
const SALES_TAX_RATE_TABLE = 'sales_tax_rates'
// This module's own table (`CustomerGroup`'s `@Entity({ tableName })`), referenced
// from the raw orphan-scan SQL's `NOT EXISTS` probe.
const CUSTOMER_GROUP_TABLE = 'customer_groups'

const SAMPLE_LIMIT = 5

export type OrphanCustomerGroupReference = {
  groupId: string
  /** Tenant the orphaned rows reference (derived from the referencing rows' own `tenant_id`). */
  tenantId: string | null
  catalogPriceCount: number
  salesTaxRateCount: number
  sampleCatalogPriceIds: string[]
  sampleSalesTaxRateIds: string[]
}

export type ScanOrphanedCustomerGroupsScope = {
  tenantId?: string | null
}

type OrphanAggregateRow = {
  group_id: string
  ref_count: number | string
  sample_ids: string[] | null
  tenant_id: string | null
}

type OrphanAggregate = { count: number; sampleIds: string[]; tenantId: string | null }

// One aggregate row per orphaned `customer_group_id` in `table`, computed entirely in
// SQL so the scan's cost to this process is bounded by the number of distinct orphan
// ids — never by the number of referencing price/tax rows (the admin list's orphan
// banner runs this scan on every page load). The `NOT EXISTS` probe deliberately has
// no `deleted_at` filter: a soft-deleted group still "exists" for FK resolution.
// `SAMPLE_LIMIT` is a module constant, not caller input, so inlining it in the array
// slice is safe; the tenant id is always bound as a parameter.
async function selectOrphanAggregates(
  em: EntityManager,
  table: string,
  tenantId: string | null | undefined,
): Promise<Map<string, OrphanAggregate>> {
  const conn = em.getConnection()
  const tenantFilter = tenantId ? ' and t.tenant_id = ?' : ''
  const sql =
    `select t.customer_group_id as group_id, count(*)::int as ref_count, ` +
    `(array_agg(t.id::text order by t.id))[1:${SAMPLE_LIMIT}] as sample_ids, ` +
    `min(t.tenant_id::text) as tenant_id ` +
    `from ${table} t ` +
    `where t.customer_group_id is not null${tenantFilter} ` +
    `and not exists (select 1 from ${CUSTOMER_GROUP_TABLE} g where g.id = t.customer_group_id) ` +
    `group by t.customer_group_id ` +
    `order by t.customer_group_id`
  const params = tenantId ? [tenantId] : []
  const rows = await conn.execute(sql, params)
  const aggregates = new Map<string, OrphanAggregate>()
  for (const row of (Array.isArray(rows) ? rows : []) as OrphanAggregateRow[]) {
    const groupId = String(row.group_id)
    aggregates.set(groupId, {
      count: Number(row.ref_count) || 0,
      sampleIds: Array.isArray(row.sample_ids) ? row.sample_ids.slice(0, SAMPLE_LIMIT).map(String) : [],
      tenantId: row.tenant_id ?? null,
    })
  }
  return aggregates
}

/**
 * Scans `catalog_product_variant_prices.customer_group_id` and
 * `sales_tax_rates.customer_group_id` for every distinct non-null value that has
 * NO matching row in `customer_groups` (any row, including soft-deleted ones —
 * a soft-deleted group still "exists" for FK-resolution purposes; only a value
 * that never — or no longer — resolves to any `customer_groups` row counts as
 * orphaned). Counts, samples (first `SAMPLE_LIMIT` ids by id order) and the
 * referencing tenant are aggregated in SQL, one query per referencing table.
 */
export async function scanOrphanedCustomerGroupReferences(
  em: EntityManager,
  scope: ScanOrphanedCustomerGroupsScope = {},
): Promise<OrphanCustomerGroupReference[]> {
  const [priceAggregates, taxAggregates] = await Promise.all([
    selectOrphanAggregates(em, CATALOG_PRICE_TABLE, scope.tenantId),
    selectOrphanAggregates(em, SALES_TAX_RATE_TABLE, scope.tenantId),
  ])

  const orphanGroupIds = new Set<string>([...priceAggregates.keys(), ...taxAggregates.keys()])
  return Array.from(orphanGroupIds).map((groupId) => {
    const price = priceAggregates.get(groupId)
    const tax = taxAggregates.get(groupId)
    return {
      groupId,
      tenantId: price?.tenantId ?? tax?.tenantId ?? null,
      catalogPriceCount: price?.count ?? 0,
      salesTaxRateCount: tax?.count ?? 0,
      sampleCatalogPriceIds: price?.sampleIds ?? [],
      sampleSalesTaxRateIds: tax?.sampleIds ?? [],
    }
  })
}

export type AdoptedCustomerGroup = {
  groupId: string
  tenantId: string
  code: string
}

function shortUuid(id: string): string {
  return id.replace(/-/g, '').slice(0, 8)
}

/**
 * Creates one placeholder `CustomerGroup` row per orphan, reusing the orphan's
 * OWN id as the new row's primary key — this is what actually "adopts" the
 * dangling `catalog_product_variant_prices.customer_group_id` /
 * `sales_tax_rates.customer_group_id` values: they already point at this id, so
 * once a `customer_groups` row exists at that id, the reference resolves.
 *
 * Orphans without a resolvable `tenantId` (should not happen — every referencing
 * row carries its own `tenant_id`) are skipped; the caller is expected to report
 * them separately.
 */
export async function adoptOrphanedCustomerGroups(
  em: EntityManager,
  orphans: OrphanCustomerGroupReference[],
): Promise<AdoptedCustomerGroup[]> {
  const adoptable = orphans.filter((orphan): orphan is OrphanCustomerGroupReference & { tenantId: string } =>
    Boolean(orphan.tenantId),
  )
  if (!adoptable.length) return []

  const orphansByTenant = new Map<string, typeof adoptable>()
  for (const orphan of adoptable) {
    const list = orphansByTenant.get(orphan.tenantId) ?? []
    list.push(orphan)
    orphansByTenant.set(orphan.tenantId, list)
  }

  const adopted: AdoptedCustomerGroup[] = []
  // One `findOne` + `flush()` cycle per tenant, with no query in between: the
  // per-tenant `findOne` always runs before that tenant's `persist()` calls, so
  // there is no scalar-mutation-then-query interleaving on this `EntityManager`
  // for `withAtomicFlush` (packages/core/AGENTS.md § Entity Update Safety) to
  // guard against.
  for (const [tenantId, tenantOrphans] of orphansByTenant) {
    const lowestPriorityGroup = await em.findOne(
      CustomerGroup,
      { tenantId },
      { orderBy: { priority: 'asc' } },
    )
    // Deliberately NOT floored at 0 per step: `(tenant_id, priority)` is unique
    // (partial, excluding soft-deleted rows — see data/entities.ts), so flooring
    // every step at 0 would assign the same priority to every orphan past the
    // first once the tenant's existing minimum is within ~10 of zero, and the
    // batch flush below would throw a raw unique-violation instead of adopting
    // cleanly. These rows are always `isActive: false` — resolveGroups() never
    // returns inactive groups, and the admin list treats priority as purely
    // informational/sortable — so a negative value here is harmless; only the
    // create/update API's zod validator (customerGroupCreateSchema.priority,
    // min(0)) enforces non-negative, and this direct EntityManager write never
    // goes through it. Each tenant's minimum is re-queried fresh on every
    // adopt() call, so later invocations continue below whatever the previous
    // batch landed on — self-healing across runs, never just across one batch.
    let nextPriority = (lowestPriorityGroup?.priority ?? 10) - 10
    for (const orphan of tenantOrphans) {
      const shortId = shortUuid(orphan.groupId)
      const code = `orphan-${shortId}`
      const group = em.create(CustomerGroup, {
        id: orphan.groupId,
        tenantId,
        organizationId: null,
        code,
        name: `Orphaned group ${shortId}`,
        description: null,
        kind: 'internal',
        parentId: null,
        priority: nextPriority,
        isDefault: false,
        isActive: false,
        metadata: null,
      })
      em.persist(group)
      adopted.push({ groupId: orphan.groupId, tenantId, code })
      nextPriority -= 10
    }
    await em.flush()
  }
  return adopted
}
