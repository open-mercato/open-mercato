import type { EntityManager } from '@mikro-orm/postgresql'
import { matchesScope } from '@open-mercato/shared/lib/catalog-visibility'
import type { EffectiveAssortmentScope } from '@open-mercato/shared/lib/catalog-visibility'
import type {
  CatalogScopedProductService,
  ScopedProductScope,
} from '@open-mercato/core/modules/catalog/services/catalogScopedProductService'

// Step 4.4 — the ONLY place in `cart` permitted to call `matchesScope` directly (§6a).
// Every call site — §6a.1c's per-line check on add/update/bulkAdd, §6a.2's whole-cart
// re-visibility pass, §6a.5's merge pass — goes through `evaluateCartVisibility`. Those
// call sites are later steps (4.5/4.6); this step only builds the primitive they share.

/**
 * Cart-local alias of `EffectiveAssortmentScope`. Kept as a plain re-export rather than a
 * richer wrapper: every field `cart` needs (`null` = unrestricted, `[]` = deny-all, a
 * populated array = OR-of-AND-scopes) is already carried by `EffectiveAssortmentScope`
 * itself, and `cart` adds no extra invariant on top of it (unlike `ResolvedCartRouteContext`,
 * which DOES need a richer shape because it bundles store/channel/buyer identity alongside
 * the scope). A branded nominal type was considered — this codebase has no existing
 * `Brand`/`__brand` helper (checked, see `routeContext.ts`'s own note on the same question)
 * — and rejected for the same reason: there is no extra invariant to protect against being
 * structurally substituted for a plain `EffectiveAssortmentScope`.
 */
export type ResolvedAssortmentScope = EffectiveAssortmentScope

/**
 * A single product/variant pair to check. `variantId` plays NO role in the visibility
 * decision — see the module-level note on "variant-derives-product" below — it only
 * identifies which concrete SKU-level row the caller's cart line is about, for building the
 * batch key.
 */
export type CartVisibilityLineRef = {
  productId: string
  variantId?: string | null
}

/**
 * The uniform, non-enumerating outcome (§6a.3): a restricted product and a nonexistent/
 * deleted/cross-tenant product id produce the identical `'unavailable'` value — never a
 * distinguishable one. Callers switch on this union (or use `isVisible`/`isUnavailable`)
 * rather than re-deriving the collapse themselves.
 */
export type CartVisibilityOutcome = 'visible' | 'unavailable'

export type CartVisibilityResult = Map<string, CartVisibilityOutcome>

export function isVisible(outcome: CartVisibilityOutcome): boolean {
  return outcome === 'visible'
}

export function isUnavailable(outcome: CartVisibilityOutcome): boolean {
  return outcome === 'unavailable'
}

/**
 * Stable batch-key identity: `${productId}:${variantId ?? ''}`. Two lines that reference the
 * same product (and, if present, the same variant) collapse to the same map entry — correct,
 * since visibility is a property of the product/variant pair, not of which cart line happens
 * to hold it. Callers key their own per-line lookups with the same pair.
 */
export function cartVisibilityKey(line: CartVisibilityLineRef): string {
  return `${line.productId}:${line.variantId ?? ''}`
}

export type CartVisibilityContainer = {
  resolve: <T = unknown>(name: string) => T
}

export type EvaluateCartVisibilityInput = {
  /** Batch of product/variant pairs to check — up to `bulkAdd`'s own 100-line cap (§15/Step 4.6). */
  lines: CartVisibilityLineRef[]
  /**
   * The resolved assortment scope, or `undefined` when assortment enforcement does not apply
   * to this call at all. This mirrors `shouldEnforceAssortmentScope`'s own `undefined` vs.
   * `null`/array distinction (`routeContext.ts`) rather than taking a separate boolean:
   * `undefined` means "no `ResolvedCartRouteContext` was supplied for this call" (§6a.1b/
   * §6a.4 — a non-storefront cart with nothing resolved is exempt by construction), while
   * `null` is a legitimate RESOLVED-but-unrestricted scope (every product matches). Callers
   * that already computed `shouldEnforceAssortmentScope(cart.channel, resolvedScope)` and got
   * `false` should pass `undefined` here (or simply skip calling this function); callers that
   * got `true` pass the same `resolvedScope` they already have on hand — no re-derivation,
   * no second boolean parameter to keep in sync with the first.
   */
  scope: ResolvedAssortmentScope | undefined
  tenantScope: ScopedProductScope
  em: EntityManager
  container: CartVisibilityContainer
}

/**
 * Batch-evaluates visibility for a set of product/variant pairs against a resolved
 * assortment scope.
 *
 * **Enforcement off** (`scope === undefined`): every pair resolves to `'visible'` without
 * ever calling `catalogScopedProductService` — mirrors §6a.4's "exempt by construction": a
 * cart channel outside the enforcement key has nothing to check against, not merely an
 * unrestricted check.
 *
 * **Enforcement on** (`scope` is `null` or an `AssortmentScope[]`): resolves every distinct
 * `productId` in one batched `catalogScopedProductService.loadScopedProducts` call (never
 * one-at-a-time — `bulkAdd` can submit up to 100 lines per call, PLAN.md's Step 4.6 row), then
 * for each input pair:
 *   - a `null` record (product missing, soft-deleted, or belongs to another tenant/org) ->
 *     `'unavailable'`
 *   - a found record -> `matchesScope({ id, categoryIds, tagIds }, scope)` decides `'visible'`
 *     vs `'unavailable'`
 *
 * **Variant-derives-product.** `loadScopedProducts` takes product ids, not variant ids — a
 * variant carries no category/tag assignment of its own in `catalog`; visibility is always the
 * PARENT PRODUCT's. So a line's `variantId` is never looked up or passed to the catalog
 * service; it is used only to build this pair's batch key (`cartVisibilityKey`) so the caller
 * can map the result back to the right line. Two lines for the same product but different
 * variants always get the SAME outcome as the bare product id alone would.
 *
 * **No enumeration oracle (§6a.3).** The `null`-record branch and the found-but-non-matching
 * branch both terminate at the exact same `'unavailable'` string — there is no intermediate
 * state (e.g. a `'not_found'` vs `'restricted'` distinction) for a caller to leak outward.
 */
export async function evaluateCartVisibility(
  input: EvaluateCartVisibilityInput,
): Promise<CartVisibilityResult> {
  const { lines, scope, tenantScope, em, container } = input
  const result: CartVisibilityResult = new Map()
  if (lines.length === 0) return result

  if (scope === undefined) {
    for (const line of lines) result.set(cartVisibilityKey(line), 'visible')
    return result
  }

  const productIds = Array.from(new Set(lines.map((line) => line.productId)))
  const catalogScopedProductService = container.resolve<CatalogScopedProductService>(
    'catalogScopedProductService',
  )
  const scopedProducts = await catalogScopedProductService.loadScopedProducts(em, productIds, tenantScope)

  for (const line of lines) {
    const record = scopedProducts.get(line.productId) ?? null
    const outcome: CartVisibilityOutcome =
      record && matchesScope({ id: record.id, categoryIds: record.categoryIds, tagIds: record.tagIds }, scope)
        ? 'visible'
        : 'unavailable'
    result.set(cartVisibilityKey(line), outcome)
  }

  return result
}
