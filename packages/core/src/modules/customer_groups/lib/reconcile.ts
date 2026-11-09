import type { EntityManager } from '@mikro-orm/postgresql'
import { conflict, isUniqueViolation, type CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CustomerGroup } from '../data/entities'
import { emitCustomerGroupLifecycleEvent } from './groupEvents'

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
// Postgres' default name for the table's `primary key ("id")` (see the module migration).
const CUSTOMER_GROUP_PRIMARY_KEY_CONSTRAINT = 'customer_groups_pkey'
const CUSTOMER_GROUP_CODE_UNIQUE_CONSTRAINT = 'customer_groups_tenant_code_unique'

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
// no `deleted_at` filter: a soft-deleted group still "exists" for FK resolution. It IS
// tenant-matched: a row pointing at another tenant's group id does not resolve for its
// own tenant (every reader is tenant-scoped), so it is reported as an orphan.
// `SAMPLE_LIMIT` is a module constant, not caller input, so inlining it in the array
// slice is safe; the tenant id is always bound as a parameter.
// `catalog` and `sales` are optional modules, so a referencing table may be absent;
// it then holds no references and contributes no orphans.
async function isTablePresent(em: EntityManager, table: string): Promise<boolean> {
  const rows = await em.getConnection().execute('select to_regclass(?) is not null as present', [table])
  return Array.isArray(rows) && (rows[0] as { present?: unknown } | undefined)?.present === true
}

async function selectOrphanAggregates(
  em: EntityManager,
  table: string,
  tenantId: string | null | undefined,
): Promise<Map<string, OrphanAggregate>> {
  const aggregates = new Map<string, OrphanAggregate>()
  if (!(await isTablePresent(em, table))) return aggregates
  const conn = em.getConnection()
  const tenantFilter = tenantId ? ' and t.tenant_id = ?' : ''
  const sql =
    `select t.customer_group_id as group_id, count(*)::int as ref_count, ` +
    `(array_agg(t.id::text order by t.id))[1:${SAMPLE_LIMIT}] as sample_ids, ` +
    `min(t.tenant_id::text) as tenant_id ` +
    `from ${table} t ` +
    `where t.customer_group_id is not null${tenantFilter} ` +
    `and not exists (select 1 from ${CUSTOMER_GROUP_TABLE} g where g.id = t.customer_group_id and g.tenant_id = t.tenant_id) ` +
    `group by t.customer_group_id ` +
    `order by t.customer_group_id`
  const params = tenantId ? [tenantId] : []
  const rows = await conn.execute(sql, params)
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
 * NO matching row of the referencing row's own tenant in `customer_groups` (any
 * such row, including soft-deleted ones — a soft-deleted group still "exists" for
 * FK-resolution purposes; only a value that never — or no longer — resolves to a
 * same-tenant `customer_groups` row counts as orphaned). Counts, samples (first `SAMPLE_LIMIT` ids by id order) and the
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

function hexUuid(id: string): string {
  return id.replace(/-/g, '')
}

function shortUuid(id: string): string {
  return hexUuid(id).slice(0, 8)
}

// Spec §8.2 names placeholders `orphan-<short-uuid>`. Eight hex characters can collide
// with an existing code (or with another orphan of the same batch sharing the prefix),
// so a taken short code falls back to the full 32-character id, which is unique per
// orphan. Only a group that already owns the full-id code too leaves no candidate.
function pickOrphanCode(groupId: string, takenCodes: Set<string>): string | null {
  for (const candidate of [`orphan-${shortUuid(groupId)}`, `orphan-${hexUuid(groupId)}`]) {
    if (!takenCodes.has(candidate)) return candidate
  }
  return null
}

async function adoptConflict(key: string, fallback: string): Promise<CrudHttpError> {
  const { translate } = await resolveTranslations()
  return conflict(translate(key, fallback))
}

const ORPHAN_ID_TAKEN = {
  key: 'customer_groups.errors.orphanIdTaken',
  fallback: 'An orphaned group id is already used by another customer group, so it cannot be adopted.',
}
const ORPHAN_CODE_TAKEN = {
  key: 'customer_groups.errors.orphanCodeTaken',
  fallback: 'A placeholder code for an orphaned group is already in use. Rename the conflicting group and try again.',
}
const ADOPT_CONFLICT = {
  key: 'customer_groups.errors.adoptConflict',
  fallback: 'Another change affected customer groups while adopting. Reload and try again.',
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
 *
 * Throws a translated 409 when an orphan id is already a `customer_groups` primary key
 * (another tenant's group: the scan is tenant-matched, but the primary key is global)
 * or when no free placeholder code is left. Emits
 * `customer_groups.group.created` for every adopted group once its tenant's batch is
 * written, as the group CRUD route does for a created group.
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
  // One read phase + `flush()` cycle per tenant: every per-tenant query (lowest
  // priority, id and code pre-checks) runs before that tenant's `persist()` calls, so
  // there is no scalar-mutation-then-query interleaving on this `EntityManager`
  // for `withAtomicFlush` (packages/core/AGENTS.md § Entity Update Safety) to
  // guard against.
  for (const [tenantId, scannedOrphans] of orphansByTenant) {
    const lowestPriorityGroup = await em.findOne(
      CustomerGroup,
      { tenantId },
      { orderBy: { priority: 'asc' } },
    )
    // The id is the primary key, which is global, so this probe is deliberately not
    // tenant-filtered; it only answers "is this id free" and returns nothing further.
    // An id already held by a group is a reference to ANOTHER tenant's group (a
    // same-tenant one would not be an orphan). It cannot be adopted here without
    // colliding on the primary key, so it is skipped — the rest of the tenant's orphans
    // are still adopted — and only a batch where every id is taken is a conflict.
    const orphanIds = scannedOrphans.map((orphan) => orphan.groupId)
    const groupsHoldingOrphanIds = await em.find(CustomerGroup, { id: { $in: orphanIds } }, { fields: ['id'] })
    const takenOrphanIds = new Set(groupsHoldingOrphanIds.map((group) => group.id))
    const tenantOrphans = scannedOrphans.filter((orphan) => !takenOrphanIds.has(orphan.groupId))
    if (!tenantOrphans.length) throw await adoptConflict(ORPHAN_ID_TAKEN.key, ORPHAN_ID_TAKEN.fallback)
    const candidateCodes = tenantOrphans.flatMap((orphan) => [
      `orphan-${shortUuid(orphan.groupId)}`,
      `orphan-${hexUuid(orphan.groupId)}`,
    ])
    const groupsHoldingCodes = await em.find(
      CustomerGroup,
      { tenantId, code: { $in: candidateCodes }, deletedAt: null },
      { fields: ['code'] },
    )
    const takenCodes = new Set(groupsHoldingCodes.map((group) => group.code))
    // Deliberately NOT floored at 0 per step: `(tenant_id, priority)` is unique
    // (partial, excluding soft-deleted rows — see data/entities.ts), so flooring
    // every step at 0 would assign the same priority to every orphan past the
    // first once the tenant's existing minimum is within ~10 of zero, and the
    // batch flush below would throw a raw unique-violation instead of adopting
    // cleanly. These rows are always `isActive: false` — resolveGroups() never
    // returns inactive groups, and the admin list treats priority as purely
    // informational/sortable — so a negative value here is harmless, and the
    // create/update zod validators accept negative priorities down to their floor so
    // the edit form can still save an adopted group. Each tenant's minimum is re-queried fresh on
    // every adopt() call, so later invocations continue below whatever the previous
    // batch landed on — self-healing across runs, never just across one batch.
    let nextPriority = (lowestPriorityGroup?.priority ?? 10) - 10
    const tenantAdopted: AdoptedCustomerGroup[] = []
    for (const orphan of tenantOrphans) {
      const shortId = shortUuid(orphan.groupId)
      const code = pickOrphanCode(orphan.groupId, takenCodes)
      if (!code) throw await adoptConflict(ORPHAN_CODE_TAKEN.key, ORPHAN_CODE_TAKEN.fallback)
      takenCodes.add(code)
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
      tenantAdopted.push({ groupId: orphan.groupId, tenantId, code })
      nextPriority -= 10
    }
    try {
      await em.flush()
    } catch (err) {
      // A concurrent write that landed between the pre-checks and this flush.
      if (isUniqueViolation(err, CUSTOMER_GROUP_PRIMARY_KEY_CONSTRAINT)) {
        throw await adoptConflict(ORPHAN_ID_TAKEN.key, ORPHAN_ID_TAKEN.fallback)
      }
      if (isUniqueViolation(err, CUSTOMER_GROUP_CODE_UNIQUE_CONSTRAINT)) {
        throw await adoptConflict(ORPHAN_CODE_TAKEN.key, ORPHAN_CODE_TAKEN.fallback)
      }
      if (isUniqueViolation(err)) throw await adoptConflict(ADOPT_CONFLICT.key, ADOPT_CONFLICT.fallback)
      throw err
    }
    for (const group of tenantAdopted) {
      await emitCustomerGroupLifecycleEvent('customer_groups.group.created', { id: group.groupId, tenantId })
    }
    adopted.push(...tenantAdopted)
  }
  return adopted
}
