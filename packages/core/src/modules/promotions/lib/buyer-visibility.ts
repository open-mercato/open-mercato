import type { EntityManager } from '@mikro-orm/postgresql'
import {
  computeProductScopeKeys,
  PRODUCT_SCOPE_CATEGORY_PREFIX,
  PRODUCT_SCOPE_TAG_PREFIX,
} from '@open-mercato/core/modules/catalog/lib/productScopeKeys'
import { matchesScope } from '@open-mercato/shared/lib/catalog-visibility'
import type { EffectiveAssortmentScope, ScopedProduct } from '@open-mercato/shared/lib/catalog-visibility'
import type { CustomerGroupsService } from '@open-mercato/core/modules/customer_groups/services/customerGroupsService'
import type { NormalizedPromotion, NormalizedRuleGroup } from './types'

// SPEC-055 §Cart-Facing Endpoints — `GET /dynamic-labels` / `POST /free-products` /
// `POST /product-page` (rev V2): "Returns only promotions whose scope the caller's own
// buyer context can see ... a reward the buyer's assortment would hide is never offered
// here either."
//
// Investigated (Step 2.7): `ecommerce/lib/buyerContext.ts`'s `resolveBuyerContext` is NOT
// reusable here — it resolves a storefront-specific `ResolvedStore` (channel/domain/slug
// binding), and none of these four routes' wire contracts carry a store or channel
// identifier at all (§Cart-Facing Endpoints' own request bodies: `evaluate`,
// `product-page`, `free-products` — none mention a store/channel; `dynamic-labels` has no
// body). What IS reusable, with zero channel/store dependency:
// `customer_groups.CustomerGroupsService.resolveAssortmentScope({ customerId, customerIds,
// tenantId })` — that service is tenant-scoped only (see its own "Groups are tenant-scoped,
// not organization-scoped" comment), so it needs nothing these routes cannot already
// supply from `auth`/the request body's own `BuyerContext`. Used here instead of
// `ecommerce`'s heavier buyer-context layer.

export type BuyerVisibilityContainer = {
  resolve: <T = unknown>(name: string) => T
}

function tryResolveCustomerGroupsService(container: BuyerVisibilityContainer): CustomerGroupsService | null {
  try {
    return container.resolve<CustomerGroupsService>('customerGroupsService') ?? null
  } catch {
    return null
  }
}

/**
 * Resolves the caller's effective assortment scope from a promotions `BuyerContext`-shaped
 * identity (`customerId`/`customerIds`). `{ resolved: false }` means the caller MUST return an empty
 * list/no-badge response rather than guessing. `{ resolved: true, scope }` carries the
 * real `EffectiveAssortmentScope` (`null` here legitimately means unrestricted — every
 * group's own scope was unrestricted, a real and common outcome, not a failure).
 */
export async function resolveBuyerAssortmentScopeOrEmpty(
  container: BuyerVisibilityContainer,
  input: { customerId: string | null; customerIds: string[]; tenantId: string },
): Promise<{ resolved: true; scope: EffectiveAssortmentScope } | { resolved: false }> {
  const service = tryResolveCustomerGroupsService(container)
  if (!service) return { resolved: false }
  try {
    const resolved = await service.resolveAssortmentScope({
      customerId: input.customerId,
      customerIds: input.customerIds,
      tenantId: input.tenantId,
    })
    return { resolved: true, scope: resolved.scope }
  } catch {
    return { resolved: false }
  }
}

function toScopedProduct(id: string, categoryIds: string[], tagIds: string[]): ScopedProduct {
  return { id, categoryIds, tagIds }
}

export function isProductVisibleInScope(
  product: { id: string; categoryIds: string[]; tagIds: string[] },
  scope: EffectiveAssortmentScope,
): boolean {
  return matchesScope(toScopedProduct(product.id, product.categoryIds, product.tagIds), scope)
}

function isCategoryVisibleInScope(categoryId: string, scope: EffectiveAssortmentScope): boolean {
  return matchesScope(toScopedProduct(`category:${categoryId}`, [categoryId], []), scope)
}

/**
 * Batch-resolves each product's real category/tag membership — the same
 * `computeProductScopeKeys` call `lib/promotions-service.ts`'s own
 * `resolveCategoryIdsForProducts` already uses for rule-side enrichment — and returns the
 * subset of `productIds` the given scope admits. Used by `product-page`/`free-products`,
 * which both operate on a concrete, already-known `productId` (the resolved SKU, or the
 * free-item effect's own `productId`).
 */
export async function filterProductIdsByScope(
  em: EntityManager,
  productIds: readonly string[],
  tenantScope: { tenantId: string; organizationId: string },
  scope: EffectiveAssortmentScope,
): Promise<Set<string>> {
  const visible = new Set<string>()
  if (productIds.length === 0) return visible
  const db = em.getKysely<any>()
  const scopeKeys = await computeProductScopeKeys(db, productIds, tenantScope)
  for (const productId of productIds) {
    const keys = scopeKeys.get(productId) ?? []
    const categoryIds = keys
      .filter((key) => key.startsWith(PRODUCT_SCOPE_CATEGORY_PREFIX))
      .map((key) => key.slice(PRODUCT_SCOPE_CATEGORY_PREFIX.length))
    const tagIds = keys
      .filter((key) => key.startsWith(PRODUCT_SCOPE_TAG_PREFIX))
      .map((key) => key.slice(PRODUCT_SCOPE_TAG_PREFIX.length))
    if (isProductVisibleInScope({ id: productId, categoryIds, tagIds }, scope)) visible.add(productId)
  }
  return visible
}

// ---------------------------------------------------------------------------
// Rule/benefit config category & product references — `GET /api/promotions/
// dynamic-labels` has no concrete product in context (it lists promotions, not a cart or
// a SKU), so visibility there is checked against the promotion's OWN configured rule/
// benefit references instead of a real product's resolved category membership. Field
// names mirror every Release-4 shipped rule/benefit type's config shape exactly
// (`lib/rule-evaluators.ts`'s `evaluateRule` dispatch, `lib/effect-resolvers.ts`'s
// `resolveEffects` dispatch, `lib/unit-selection.ts`) — kept in sync by hand since the
// normalized shape (`lib/types.ts`'s `NormalizedRule`/`NormalizedBenefit`) carries
// `config: Record<string, unknown>` with no schema attached at read time.
// ---------------------------------------------------------------------------

const CATEGORY_CONFIG_KEYS = ['categoryId', 'limitToCategory', 'limitToCategoryId', 'triggerCategoryId'] as const
const PRODUCT_CONFIG_KEYS = ['productId', 'triggerProductId', 'rewardProductId'] as const

function collectRefs(config: Record<string, unknown>, keys: readonly string[], into: Set<string>): void {
  for (const key of keys) {
    const value = config[key]
    if (typeof value === 'string' && value.length > 0) into.add(value)
  }
}

function walkRuleGroup(group: NormalizedRuleGroup, categoryIds: Set<string>, productIds: Set<string>): void {
  for (const rule of group.rules) {
    collectRefs(rule.config, CATEGORY_CONFIG_KEYS, categoryIds)
    collectRefs(rule.config, PRODUCT_CONFIG_KEYS, productIds)
  }
  for (const benefit of group.benefits) {
    collectRefs(benefit.config, CATEGORY_CONFIG_KEYS, categoryIds)
    collectRefs(benefit.config, PRODUCT_CONFIG_KEYS, productIds)
  }
  for (const child of group.children) walkRuleGroup(child, categoryIds, productIds)
}

export function extractPromotionCategoryAndProductRefs(
  promotion: NormalizedPromotion,
): { categoryIds: string[]; productIds: string[] } {
  const categoryIds = new Set<string>()
  const productIds = new Set<string>()
  walkRuleGroup(promotion.rootGroup, categoryIds, productIds)
  return { categoryIds: Array.from(categoryIds), productIds: Array.from(productIds) }
}

/**
 * `true` when every category/product this promotion's rule tree references is visible in
 * `scope`. A promotion with no category/product reference at all (e.g. a pure
 * `order_value`/`customer_group` rule) is always visible — there is nothing to hide.
 * Product references are checked by id only (no per-SKU context exists to batch-resolve
 * their real categories against for this route) — under any category/tag-restricted
 * scope a bare product-id reference with no known category membership fails closed to
 * hidden, per this module's "unknowable field evaluates false" convention.
 */
export function isPromotionVisibleInScope(promotion: NormalizedPromotion, scope: EffectiveAssortmentScope): boolean {
  if (scope === null) return true
  const { categoryIds, productIds } = extractPromotionCategoryAndProductRefs(promotion)
  for (const categoryId of categoryIds) {
    if (!isCategoryVisibleInScope(categoryId, scope)) return false
  }
  for (const productId of productIds) {
    if (!isProductVisibleInScope({ id: productId, categoryIds: [], tagIds: [] }, scope)) return false
  }
  return true
}
