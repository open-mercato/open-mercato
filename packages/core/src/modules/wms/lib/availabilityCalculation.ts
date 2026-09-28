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

async function loadBalanceAggregates(
  em: EntityManager,
  tenantId: string,
  organizationId: string,
  variantIds: string[],
  locationIds?: string[] | null,
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  if (variantIds.length === 0) return result

  const variantClause = buildSqlInClause('b.catalog_variant_id', variantIds)
  const params: unknown[] = [organizationId, tenantId, ...variantClause.params]
  let locationClause = ''
  if (locationIds && locationIds.length > 0) {
    const locationIn = buildSqlInClause('b.location_id', locationIds)
    locationClause = ` and ${locationIn.sql}`
    params.push(...locationIn.params)
  }

  const sql = `
    select b.catalog_variant_id,
           sum(coalesce(b.quantity_on_hand, 0) - coalesce(b.quantity_reserved, 0) - coalesce(b.quantity_allocated, 0)) as aggregate_available
    from wms_inventory_balances b
    where b.organization_id = ? and b.tenant_id = ? and ${variantClause.sql} and b.deleted_at is null
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

function findProfile(profiles: ProfileRow[], productId: string, variantId: string | null): ProfileRow | null {
  if (variantId) {
    const variantRow = profiles.find((p) => p.catalog_variant_id === variantId)
    if (variantRow) return variantRow
  }
  return profiles.find((p) => p.catalog_product_id === productId && !p.catalog_variant_id) ?? null
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

  // One balance aggregation and one profile lookup for the whole batch (R4).
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
    : policyScopes.map(() => OPEN_POLICY_DEFAULT)

  function sellableFor(variantId: string, productId: string): number {
    const aggregate = balances.get(variantId) ?? 0
    const profile = findProfile(profiles, productId, variantId)
    const safetyStock = profile ? Number(profile.safety_stock ?? 0) : 0
    return Math.max(0, aggregate - safetyStock)
  }

  query.items.forEach((item, index) => {
    const policy = resolvedPolicies[index] ?? OPEN_POLICY_DEFAULT
    const key = availabilityItemKey(item)

    if (!policy.isStockManaged.value) {
      byItem[key] = {
        state: 'not_tracked',
        availableQuantity: null,
        canFulfil: true,
        leadTimeDays: null,
        releaseAt: null,
        isAuthoritative: true,
        policySourceId: policy.isStockManaged.policySourceId,
      }
      return
    }

    let sellable: number
    let reorderPoint: number | null = null
    if (item.catalogVariantId) {
      sellable = sellableFor(item.catalogVariantId, item.catalogProductId)
      const profile = findProfile(profiles, item.catalogProductId, item.catalogVariantId)
      reorderPoint = profile && profile.reorder_point != null ? Number(profile.reorder_point) : null
    } else {
      const variantIds = variantsByProduct.get(item.catalogProductId) ?? []
      sellable = variantIds.reduce((sum, variantId) => sum + sellableFor(variantId, item.catalogProductId), 0)
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
      canFulfil: computed.canFulfil,
      leadTimeDays: computed.leadTimeDays,
      releaseAt: computed.releaseAt,
      isAuthoritative: true,
      policySourceId: policy.isStockManaged.policySourceId,
    }
  })

  return { byItem }
}
