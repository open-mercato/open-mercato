/**
 * `wms`'s `AvailabilityProvider` computation — batched sellable-quantity
 * aggregation, safety-stock handling, low-stock thresholds, and product
 * rollup.
 *
 * @see .ai/specs/2026-08-14-availability-contract.md §4.2
 *
 * Batching contract (R4): exactly one balance aggregation, one profile
 * lookup, one policy lookup, and (only when the batch has product-level
 * items) one variant-rollup lookup — never per item.
 *
 * Safety-stock contract (R1): `sellable = max(0, aggregate_available -
 * safety_stock)`, with `safety_stock` subtracted ONCE per variant, after
 * aggregating every in-scope location — never once per balance row.
 *
 * Phase 2 alignment (A2): `loadBalanceAggregates` and `computeSellableQuantities`
 * together are the one shared sellable-quantity builder the §4.2 fix calls
 * for — `loadBalanceAggregates` excludes ineligible lots (quarantined, on
 * hold, or expired, matching `wms.inventory.reserve`'s `isLotEligible`) and
 * accepts an additive `warehouseIds` filter (D-R5-31); `computeSellableQuantities`
 * is the pure arithmetic half, with a STRICT variant-level safety-stock
 * lookup (no product-pool fallback) and the product-level pool subtracted
 * exactly once, at the rollup. Neither function locks or opens a
 * transaction — a future caller already holding `FOR UPDATE` locks on the
 * balances it cares about (the Phase 2 reservation gate) gets the locked
 * variant "for free" by passing its own transactional `EntityManager`.
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import { availabilityItemKey } from '@open-mercato/shared/lib/availability'
import type { AvailabilityItemResult, AvailabilityQuery, AvailabilityResult, AvailabilityState } from '@open-mercato/shared/lib/availability'
import { tryResolve } from './tryResolve'
import { buildSqlInClause } from './sqlInClause'

type Resolver = { resolve: <T = unknown>(name: string) => T }

/**
 * Narrow, locally-declared duck type for `availability`'s `PolicyResolutionService`
 * (soft-resolved, never statically imported — `wms` never hard-requires `availability`,
 * §3.1). Structurally identical to the real service's relevant surface.
 */
type PolicyField<T> = { value: T; policySourceId: string | null }
type ResolvedPolicyOverlay = {
  isStockManaged: PolicyField<boolean>
  allowBackorder: PolicyField<boolean>
  backorderLeadTimeDays: PolicyField<number | null>
  preorderReleaseAt: PolicyField<Date | null>
  lowStockThreshold: PolicyField<number | null>
  minOrderQuantity: PolicyField<number | null>
  maxOrderQuantity: PolicyField<number | null>
  quantityIncrement: PolicyField<number | null>
  isActive: PolicyField<boolean>
}
type PolicyResolutionScopeLike = {
  tenantId: string
  organizationId: string
  storeId?: string | null
  productId: string
  variantId?: string | null
}
type PolicyResolutionServiceLike = {
  resolveMany(em: EntityManager, scopes: PolicyResolutionScopeLike[]): Promise<ResolvedPolicyOverlay[]>
}

const OPEN_POLICY_DEFAULT: ResolvedPolicyOverlay = {
  isStockManaged: { value: true, policySourceId: null },
  allowBackorder: { value: false, policySourceId: null },
  backorderLeadTimeDays: { value: null, policySourceId: null },
  preorderReleaseAt: { value: null, policySourceId: null },
  lowStockThreshold: { value: null, policySourceId: null },
  minOrderQuantity: { value: null, policySourceId: null },
  maxOrderQuantity: { value: null, policySourceId: null },
  quantityIncrement: { value: null, policySourceId: null },
  isActive: { value: true, policySourceId: null },
}

type BalanceAggregateRow = { catalog_variant_id: string; aggregate_available: string | number | null }
type ProfileRow = {
  catalog_product_id: string
  catalog_variant_id: string | null
  safety_stock: string | number | null
  reorder_point: string | number | null
}
type VariantRow = { id: string; product_id: string }

/**
 * The shared SQL half of the §4.2 sellable builder (A2). Excludes
 * ineligible lots — a balance whose lot `status` is not `'available'`, or
 * whose `expires_at` has passed, is dropped before aggregation, matching
 * the eligibility `wms.inventory.reserve`'s `isLotEligible` applies. A
 * balance with no lot (`lot_id IS NULL`) is always eligible.
 *
 * `locationIds` keeps its shipped meaning — wms LOCATION ids (D-R5-31).
 * `warehouseIds` is the additive warehouse filter from the same decision;
 * the read provider below never passes it (D-R5-31's read-side scope), but
 * the function accepts it so a future caller (the Phase 2 reservation
 * gate) can filter by warehouse without a second SQL builder.
 *
 * No `FOR UPDATE`, no transaction: this runs whatever the caller's `em`
 * already executes inside. A caller that already holds row locks on the
 * balances in scope (via its own `SELECT … FOR UPDATE`, earlier in the same
 * transaction) sees the locked, consistent values here for free.
 */
export async function loadBalanceAggregates(
  em: EntityManager,
  tenantId: string,
  organizationId: string,
  variantIds: string[],
  locationIds?: string[] | null,
  warehouseIds?: string[] | null,
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  if (variantIds.length === 0) return result

  const variantClause = buildSqlInClause('b.catalog_variant_id', variantIds)
  const params: unknown[] = [organizationId, tenantId, ...variantClause.params]
  let warehouseClause = ''
  if (warehouseIds && warehouseIds.length > 0) {
    const warehouseIn = buildSqlInClause('b.warehouse_id', warehouseIds)
    warehouseClause = ` and ${warehouseIn.sql}`
    params.push(...warehouseIn.params)
  }
  let locationClause = ''
  if (locationIds && locationIds.length > 0) {
    const locationIn = buildSqlInClause('b.location_id', locationIds)
    locationClause = ` and ${locationIn.sql}`
    params.push(...locationIn.params)
  }

  const sql = `
    select b.catalog_variant_id,
           sum(coalesce(b.quantity_available, 0)) as aggregate_available
    from wms_inventory_balances b
    left join wms_inventory_lots l on l.id = b.lot_id and l.deleted_at is null
    where b.organization_id = ? and b.tenant_id = ? and ${variantClause.sql} and b.deleted_at is null
      and (b.lot_id is null or (l.status = 'available' and (l.expires_at is null or l.expires_at > now())))
      ${warehouseClause}
      ${locationClause}
    group by b.catalog_variant_id
  `
  const rows = await em.getConnection().execute<BalanceAggregateRow[]>(sql, params)
  for (const row of rows) {
    result.set(row.catalog_variant_id, Number(row.aggregate_available ?? 0))
  }
  return result
}

async function loadProfiles(
  em: EntityManager,
  tenantId: string,
  organizationId: string,
  variantIds: string[],
  productIds: string[],
): Promise<ProfileRow[]> {
  if (variantIds.length === 0 && productIds.length === 0) return []
  const variantClause = buildSqlInClause('catalog_variant_id', variantIds)
  const productClause = buildSqlInClause('catalog_product_id', productIds)
  const sql = `
    select catalog_product_id, catalog_variant_id, safety_stock, reorder_point
    from wms_product_inventory_profiles
    where organization_id = ? and tenant_id = ? and deleted_at is null
      and (${variantClause.sql} or (${productClause.sql} and catalog_variant_id is null))
  `
  return em.getConnection().execute<ProfileRow[]>(sql, [
    organizationId,
    tenantId,
    ...variantClause.params,
    ...productClause.params,
  ])
}

async function loadActiveVariantsForProducts(
  em: EntityManager,
  tenantId: string,
  organizationId: string,
  productIds: string[],
): Promise<VariantRow[]> {
  if (productIds.length === 0) return []
  const productClause = buildSqlInClause('product_id', productIds)
  const sql = `
    select id, product_id
    from catalog_product_variants
    where organization_id = ? and tenant_id = ? and ${productClause.sql} and is_active = true and deleted_at is null
  `
  return em.getConnection().execute<VariantRow[]>(sql, [organizationId, tenantId, ...productClause.params])
}

/**
 * Any profile covering this item — a variant-level row, or (when none
 * exists) the product-level pool row. Intended ONLY for presence checks
 * (`openPolicyDefaultFor`) and the `reorder_point` low-stock threshold,
 * where falling back to the product's shared configuration is the desired
 * default (a product-wide reorder point is a sensible per-variant signal).
 *
 * NEVER use this for safety-stock subtraction on a variant-level sellable
 * query (A2) — see `findVariantProfile`/`findProductPoolProfile` below:
 * falling back to the pool row there would subtract the shared buffer once
 * per variant instead of once per product, undercounting sellable for
 * every multi-variant product that has a pool.
 */
function findProfile(profiles: ProfileRow[], productId: string, variantId: string | null): ProfileRow | null {
  if (variantId) {
    const variantRow = profiles.find((p) => p.catalog_variant_id === variantId)
    if (variantRow) return variantRow
  }
  return profiles.find((p) => p.catalog_product_id === productId && !p.catalog_variant_id) ?? null
}

/**
 * STRICT variant-level profile lookup — no product-pool fallback (A2). The
 * only correct source for a per-variant safety-stock subtraction.
 */
function findVariantProfile(profiles: ProfileRow[], variantId: string): ProfileRow | null {
  return profiles.find((p) => p.catalog_variant_id === variantId) ?? null
}

/** The product-level pool row (`catalog_variant_id IS NULL`), or null when the product has none. */
function findProductPoolProfile(profiles: ProfileRow[], productId: string): ProfileRow | null {
  return profiles.find((p) => p.catalog_product_id === productId && !p.catalog_variant_id) ?? null
}

export type SellableQuantityRequest = {
  /** Variants that need their own, standalone per-variant sellable. */
  variantIds: string[]
  /**
   * Products that need a rollup sellable — the sum of the listed variants'
   * per-variant sellable, minus the product-level pool once (A2). Used for
   * a product-level `AvailabilityItemQuery` (`catalogVariantId: null`).
   */
  productRollups: Array<{ productId: string; variantIds: string[] }>
}

export type SellableQuantityAggregates = {
  /** `aggregate_available` per variant id, from `loadBalanceAggregates` (eligible lots only). */
  balances: Map<string, number>
  /** Every profile row covering the variants/products in scope — variant rows and pool rows alike. */
  profiles: ProfileRow[]
}

/**
 * The pure arithmetic half of the §4.2 shared sellable builder (A2),
 * alongside `loadBalanceAggregates`. No I/O: the read provider below
 * supplies `balances`/`profiles` from a plain (lock-free) query, and a
 * future reservation gate can supply the exact same shapes from its own
 * locked balance rows — the two paths cannot drift because they run the
 * same arithmetic.
 *
 *   sellable(variant) = max(0, aggregate_available(variant) - safety_stock(variant))
 *
 * `safety_stock` comes from a STRICT variant-level profile row — never the
 * product-level pool row.
 *
 *   sellable(product rollup) = max(0, sum(sellable(variant) for the
 *     product's active variants) - safety_stock(product pool))
 *
 * The pool is applied exactly once, at the rollup, never per variant.
 */
export function computeSellableQuantities(
  aggregates: SellableQuantityAggregates,
  request: SellableQuantityRequest,
): { perVariant: Map<string, number>; perProductRollup: Map<string, number> } {
  const variantIdsNeeded = new Set<string>([
    ...request.variantIds,
    ...request.productRollups.flatMap((rollup) => rollup.variantIds),
  ])

  const perVariant = new Map<string, number>()
  for (const variantId of variantIdsNeeded) {
    const aggregate = aggregates.balances.get(variantId) ?? 0
    const profile = findVariantProfile(aggregates.profiles, variantId)
    const safetyStock = profile ? Number(profile.safety_stock ?? 0) : 0
    perVariant.set(variantId, Math.max(0, aggregate - safetyStock))
  }

  const perProductRollup = new Map<string, number>()
  for (const rollup of request.productRollups) {
    const sumVariantSellable = rollup.variantIds.reduce(
      (sum, variantId) => sum + (perVariant.get(variantId) ?? 0),
      0,
    )
    const poolProfile = findProductPoolProfile(aggregates.profiles, rollup.productId)
    const poolSafetyStock = poolProfile ? Number(poolProfile.safety_stock ?? 0) : 0
    perProductRollup.set(rollup.productId, Math.max(0, sumVariantSellable - poolSafetyStock))
  }

  return { perVariant, perProductRollup }
}

/**
 * The open policy default used when `availability` is not installed. §5.2:
 * `is_stock_managed` defaults to `true` only when a `ProductInventoryProfile`
 * exists for the item — an item without one is `not_tracked`, never
 * `out_of_stock`.
 */
function openPolicyDefaultFor(
  profiles: ProfileRow[],
  productId: string,
  variantId: string | null,
): ResolvedPolicyOverlay {
  const hasProfile = findProfile(profiles, productId, variantId) !== null
  return { ...OPEN_POLICY_DEFAULT, isStockManaged: { value: hasProfile, policySourceId: null } }
}

function computeState(params: {
  sellable: number
  requested: number
  lowStockThreshold: number | null
  allowBackorder: boolean
  backorderLeadTimeDays: number | null
  preorderReleaseAt: Date | null
  isActive: boolean
}): { state: AvailabilityState; canFulfil: boolean; leadTimeDays: number | null; releaseAt: string | null } {
  if (!params.isActive) {
    return { state: 'out_of_stock', canFulfil: false, leadTimeDays: null, releaseAt: null }
  }
  if (params.preorderReleaseAt && params.preorderReleaseAt.getTime() > Date.now()) {
    return { state: 'preorder', canFulfil: true, leadTimeDays: null, releaseAt: params.preorderReleaseAt.toISOString() }
  }
  if (params.sellable >= params.requested) {
    const state: AvailabilityState =
      params.lowStockThreshold != null && params.sellable <= params.lowStockThreshold ? 'low_stock' : 'in_stock'
    return { state, canFulfil: true, leadTimeDays: null, releaseAt: null }
  }
  if (params.allowBackorder) {
    return { state: 'backorder', canFulfil: true, leadTimeDays: params.backorderLeadTimeDays, releaseAt: null }
  }
  return { state: 'out_of_stock', canFulfil: false, leadTimeDays: null, releaseAt: null }
}

/**
 * Order-quantity rules (§5.1) are a cap independent of stock: a violation
 * blocks fulfilment without changing the stock-derived state.
 */
function isWithinOrderQuantityRules(requested: number, policy: ResolvedPolicyOverlay): boolean {
  const min = policy.minOrderQuantity.value
  const max = policy.maxOrderQuantity.value
  const increment = policy.quantityIncrement.value
  if (min != null && requested < min) return false
  if (max != null && requested > max) return false
  if (increment != null && increment > 0 && requested % increment !== 0) return false
  return true
}

/**
 * Mirrors the catalog-only fallback's precedence (inactive → preorder →
 * not_tracked) for an item the policy excludes from stock tracking. An inactive
 * policy makes the item unpurchasable before any preorder date, exactly as on the
 * tracked path (`computeState`).
 */
function computeUntrackedItem(policy: ResolvedPolicyOverlay): AvailabilityItemResult {
  const base: AvailabilityItemResult = {
    state: 'not_tracked',
    availableQuantity: null,
    canFulfil: true,
    leadTimeDays: null,
    releaseAt: null,
    isAuthoritative: true,
    policySourceId: policy.isStockManaged.policySourceId,
  }
  if (!policy.isActive.value) {
    return { ...base, state: 'out_of_stock', canFulfil: false, policySourceId: policy.isActive.policySourceId }
  }
  const preorderReleaseAt = policy.preorderReleaseAt.value
  if (preorderReleaseAt && preorderReleaseAt.getTime() > Date.now()) {
    return {
      ...base,
      state: 'preorder',
      releaseAt: preorderReleaseAt.toISOString(),
      policySourceId: policy.preorderReleaseAt.policySourceId,
    }
  }
  return base
}

/**
 * Computes availability for a batch of items — always live, never cached
 * (the cache wrapper lives in `availabilityCache.ts`, Phase 2 Step 3.2).
 */
export async function computeAvailability(
  em: EntityManager,
  container: Resolver,
  query: AvailabilityQuery,
): Promise<AvailabilityResult> {
  const byItem: AvailabilityResult['byItem'] = {}
  if (query.items.length === 0) return { byItem }

  const variantItems = query.items.filter((item) => !!item.catalogVariantId)
  const productItems = query.items.filter((item) => !item.catalogVariantId)
  const productItemIds = Array.from(new Set(productItems.map((item) => item.catalogProductId)))

  // One batched lookup of active variants for every product-level item (R4).
  const rollupVariantRows = await loadActiveVariantsForProducts(em, query.tenantId, query.organizationId, productItemIds)
  const variantsByProduct = new Map<string, string[]>()
  for (const row of rollupVariantRows) {
    const list = variantsByProduct.get(row.product_id) ?? []
    list.push(row.id)
    variantsByProduct.set(row.product_id, list)
  }

  const allVariantIds = Array.from(
    new Set([
      ...variantItems.map((item) => item.catalogVariantId as string),
      ...rollupVariantRows.map((row) => row.id),
    ]),
  )
  const allProductIds = Array.from(new Set(query.items.map((item) => item.catalogProductId)))

  // One balance aggregation (eligible lots only) and one profile lookup for
  // the whole batch (R4) — the SQL half of the shared sellable builder (A2).
  const [balances, profiles] = await Promise.all([
    loadBalanceAggregates(em, query.tenantId, query.organizationId, allVariantIds, query.locationIds),
    loadProfiles(em, query.tenantId, query.organizationId, allVariantIds, allProductIds),
  ])

  // One batched policy resolution for the whole batch (R4).
  const policyService = tryResolve<PolicyResolutionServiceLike>(container, 'policyResolutionService')
  const policyScopes: PolicyResolutionScopeLike[] = query.items.map((item) => ({
    tenantId: query.tenantId,
    organizationId: query.organizationId,
    storeId: query.storeId ?? null,
    productId: item.catalogProductId,
    variantId: item.catalogVariantId ?? null,
  }))
  const resolvedPolicies = policyService
    ? await policyService.resolveMany(em, policyScopes)
    : query.items.map((item) => openPolicyDefaultFor(profiles, item.catalogProductId, item.catalogVariantId ?? null))

  // The pure arithmetic half of the shared sellable builder (A2): per-variant
  // safety stock never falls back to the product pool, and the pool is
  // subtracted exactly once, at the rollup.
  const sellableQuantities = computeSellableQuantities(
    { balances, profiles },
    {
      variantIds: variantItems.map((item) => item.catalogVariantId as string),
      productRollups: productItemIds.map((productId) => ({
        productId,
        variantIds: variantsByProduct.get(productId) ?? [],
      })),
    },
  )

  query.items.forEach((item, index) => {
    const policy =
      resolvedPolicies[index]
      ?? openPolicyDefaultFor(profiles, item.catalogProductId, item.catalogVariantId ?? null)
    const key = availabilityItemKey(item)
    const withinOrderQuantityRules = isWithinOrderQuantityRules(item.quantity, policy)

    if (!policy.isStockManaged.value) {
      const untracked = computeUntrackedItem(policy)
      byItem[key] = { ...untracked, canFulfil: untracked.canFulfil && withinOrderQuantityRules }
      return
    }

    let sellable: number
    let reorderPoint: number | null = null
    if (item.catalogVariantId) {
      sellable = sellableQuantities.perVariant.get(item.catalogVariantId) ?? 0
      const profile = findProfile(profiles, item.catalogProductId, item.catalogVariantId)
      reorderPoint = profile && profile.reorder_point != null ? Number(profile.reorder_point) : null
    } else {
      sellable = sellableQuantities.perProductRollup.get(item.catalogProductId) ?? 0
      const profile = findProfile(profiles, item.catalogProductId, null)
      reorderPoint = profile && profile.reorder_point != null ? Number(profile.reorder_point) : null
    }

    const effectiveLowStockThreshold = policy.lowStockThreshold.value ?? reorderPoint

    const computed = computeState({
      sellable,
      requested: item.quantity,
      lowStockThreshold: effectiveLowStockThreshold,
      allowBackorder: policy.allowBackorder.value,
      backorderLeadTimeDays: policy.backorderLeadTimeDays.value,
      preorderReleaseAt: policy.preorderReleaseAt.value,
      isActive: policy.isActive.value,
    })

    byItem[key] = {
      state: computed.state,
      availableQuantity: sellable,
      canFulfil: computed.canFulfil && withinOrderQuantityRules,
      leadTimeDays: computed.leadTimeDays,
      releaseAt: computed.releaseAt,
      isAuthoritative: true,
      policySourceId: policy.isStockManaged.policySourceId,
    }
  })

  return { byItem }
}
