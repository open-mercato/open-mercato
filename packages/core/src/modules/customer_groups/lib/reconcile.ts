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

type ReferencingRow = { id: string; customer_group_id: string; tenant_id: string | null }

async function selectReferencingRows(
  em: EntityManager,
  table: string,
  tenantId: string | null | undefined,
): Promise<ReferencingRow[]> {
  const conn = em.getConnection()
  const sql = tenantId
    ? `select id, customer_group_id, tenant_id from ${table} where customer_group_id is not null and tenant_id = ?`
    : `select id, customer_group_id, tenant_id from ${table} where customer_group_id is not null`
  const params = tenantId ? [tenantId] : []
  const rows = await conn.execute(sql, params)
  return (Array.isArray(rows) ? rows : []) as ReferencingRow[]
}

/**
 * Scans `catalog_product_variant_prices.customer_group_id` and
 * `sales_tax_rates.customer_group_id` for every distinct non-null value that has
 * NO matching row in `customer_groups` (any row, including soft-deleted ones —
 * a soft-deleted group still "exists" for FK-resolution purposes; only a value
 * that never — or no longer — resolves to any `customer_groups` row counts as
 * orphaned).
 */
export async function scanOrphanedCustomerGroupReferences(
  em: EntityManager,
  scope: ScanOrphanedCustomerGroupsScope = {},
): Promise<OrphanCustomerGroupReference[]> {
  const [priceRows, taxRows] = await Promise.all([
    selectReferencingRows(em, CATALOG_PRICE_TABLE, scope.tenantId),
    selectReferencingRows(em, SALES_TAX_RATE_TABLE, scope.tenantId),
  ])

  const referencedGroupIds = new Set<string>()
  for (const row of priceRows) referencedGroupIds.add(row.customer_group_id)
  for (const row of taxRows) referencedGroupIds.add(row.customer_group_id)
  if (!referencedGroupIds.size) return []

  const existingGroups = await em.find(CustomerGroup, { id: { $in: Array.from(referencedGroupIds) } })
  const existingGroupIds = new Set(existingGroups.map((group) => group.id))
  const orphanGroupIds = Array.from(referencedGroupIds).filter((id) => !existingGroupIds.has(id))
  if (!orphanGroupIds.length) return []
  const orphanGroupIdSet = new Set(orphanGroupIds)

  const priceRowsByGroup = new Map<string, ReferencingRow[]>()
  for (const row of priceRows) {
    if (!orphanGroupIdSet.has(row.customer_group_id)) continue
    const list = priceRowsByGroup.get(row.customer_group_id) ?? []
    list.push(row)
    priceRowsByGroup.set(row.customer_group_id, list)
  }
  const taxRowsByGroup = new Map<string, ReferencingRow[]>()
  for (const row of taxRows) {
    if (!orphanGroupIdSet.has(row.customer_group_id)) continue
    const list = taxRowsByGroup.get(row.customer_group_id) ?? []
    list.push(row)
    taxRowsByGroup.set(row.customer_group_id, list)
  }

  return orphanGroupIds.map((groupId) => {
    const priceRowsForGroup = priceRowsByGroup.get(groupId) ?? []
    const taxRowsForGroup = taxRowsByGroup.get(groupId) ?? []
    const tenantId = priceRowsForGroup[0]?.tenant_id ?? taxRowsForGroup[0]?.tenant_id ?? null
    return {
      groupId,
      tenantId,
      catalogPriceCount: priceRowsForGroup.length,
      salesTaxRateCount: taxRowsForGroup.length,
      sampleCatalogPriceIds: priceRowsForGroup.slice(0, SAMPLE_LIMIT).map((row) => row.id),
      sampleSalesTaxRateIds: taxRowsForGroup.slice(0, SAMPLE_LIMIT).map((row) => row.id),
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
