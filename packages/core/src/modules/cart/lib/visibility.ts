import type { EntityManager } from '@mikro-orm/postgresql'
import { matchesScope } from '@open-mercato/shared/lib/catalog-visibility'
import type { EffectiveAssortmentScope } from '@open-mercato/shared/lib/catalog-visibility'
import type {
  CatalogScopedProductService,
  ScopedProductScope,
} from '@open-mercato/core/modules/catalog/services/catalogScopedProductService'
import type { CartLine } from '../data/entities'

// Step 4.4 — the ONLY place in `cart` permitted to call `matchesScope` directly (§6a).
// Every call site — §6a.1c's per-line check on add/update/bulkAdd (`commands/lines.ts`),
// §6a.2's whole-cart re-visibility pass, §6a.5's merge pass (`commands/merge.ts`) — goes
// through `evaluateCartVisibility`. §6a.2's own phase builder,
// `buildWholeCartRevisibilityPhase` below, was added at Step 7.4 — it lives here (rather
// than in `commands/cart.ts`) because it is a second, batched consumer of this same
// primitive, same reasoning the per-line check already applies in `commands/lines.ts`.

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

// ---------------------------------------------------------------------------
// §6a.2 — whole-cart re-visibility pass (Step 7.4)
// ---------------------------------------------------------------------------

export type WholeCartRevisibilityPhaseParams = {
  em: EntityManager
  container: CartVisibilityContainer
  /**
   * The cart's full non-deleted `CartLine` set (same array `cart.reprice`'s other phases
   * close over). Only `origin: 'customer'` lines are ever checked — a gift (`'promotion'`)
   * line is evaluator OUTPUT, never something the buyer added, so it has no business being
   * re-checked against the buyer's OWN assortment scope (mirrors `buildCartLineRepricePhases`/
   * `buildPromotionsEffectsPhase`'s identical `origin !== 'promotion'` exclusion).
   */
  lines: CartLine[]
  /** Already gated by the caller via `shouldEnforceAssortmentScope` — `undefined` here means
   * "do not build/run this phase at all" (the caller's own job to decide, same convention
   * `cart.reprice`'s promotions phase already uses for its gift-line check). */
  scope: ResolvedAssortmentScope | undefined
  tenantScope: ScopedProductScope
  /** Lines newly flagged `product_unavailable` by this pass (previously visible or
   * unflagged). Pushed to, never read, by this function — the caller's own accumulator,
   * same `changes`/`touched` closure convention `lib/reprice.ts` already uses. */
  flagged: CartLine[]
  /** Lines previously flagged `product_unavailable` that are visible again this cycle — the
   * flag is cleared (§6a.2 only states the failure direction; a stale flag that never
   * clears would mislead a buyer whose access was restored, since `cartView.ts`'s warning
   * surfacing reads `flagState` live on every response). */
  cleared: CartLine[]
}

/**
 * Builds the `withAtomicFlush` phase behind §6a.2's whole-cart re-visibility pass: re-checks
 * every existing, non-deleted, non-gift line's `(productId, variantId)` against the cart's
 * freshly-resolved assortment scope, flags a newly-failing line, and clears a previously-
 * flagged line that now passes. A failing line is flagged, never deleted (§6a.2's own text —
 * mirrors the out-of-stock-line precedent §10.1 already sets).
 *
 * READ-then-MUTATE within this one phase (SPEC-018): the single batched
 * `evaluateCartVisibility` call is this phase's only `em` read, and it completes before any
 * `flagState` assignment below — no interleaved query after a mutation.
 *
 * The caller (`commands/cart.ts`'s `cart.reprice`) is responsible for building/including this
 * phase ONLY for §6a.2's trigger 2 (`buyer_context_changed`) — trigger 5 (checkout lock) has no
 * call site yet (`cart.lock` is a later step) and this function does not gate on trigger
 * itself, since it has no opinion on why it was called, only on what to do once it is.
 */
export function buildWholeCartRevisibilityPhase(params: WholeCartRevisibilityPhaseParams): () => Promise<void> {
  const { em, container, lines, scope, tenantScope, flagged, cleared } = params
  return async () => {
    const customerLines = lines.filter((line) => line.origin === 'customer')
    if (customerLines.length === 0) return

    const refs: CartVisibilityLineRef[] = customerLines.map((line) => ({
      productId: line.productId,
      variantId: line.variantId ?? null,
    }))
    const visibility = await evaluateCartVisibility({ lines: refs, scope, tenantScope, em, container })

    for (const line of customerLines) {
      const ref: CartVisibilityLineRef = { productId: line.productId, variantId: line.variantId ?? null }
      const visible = isVisible(visibility.get(cartVisibilityKey(ref)) ?? 'unavailable')
      if (!visible && line.flagState !== 'product_unavailable') {
        line.flagState = 'product_unavailable'
        flagged.push(line)
      } else if (visible && line.flagState === 'product_unavailable') {
        line.flagState = null
        cleared.push(line)
      }
    }
  }
}
