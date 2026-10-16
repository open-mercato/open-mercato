import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CatalogProductPrice } from '@open-mercato/core/modules/catalog/data/entities'
import { buildPriceRowFilter, filterRowsForVariant, resolvePriceKindId } from '@open-mercato/core/modules/catalog/lib/pricing'
import type { PriceRow, PricingContext } from '@open-mercato/core/modules/catalog/lib/pricing'
import type {
  BuyerPricingContext,
  CatalogBuyerPricingService,
  ResolvedLinePrice,
} from '@open-mercato/core/modules/catalog/services/catalogBuyerPricingService'
import type { SalesCalculationService } from '@open-mercato/core/modules/sales/services/salesCalculationService'
import type { SalesAdjustmentDraft, SalesLineSnapshot } from '@open-mercato/core/modules/sales/lib/types'
import { Cart, CartLine } from '../data/entities'

// Step 5.1 — the whole-cart re-pricing engine behind the `cart.reprice` command (triggers
// 2-4, §5.2) and the real `Cart.totals` aggregate (§3.2). Closes the gap NOTIFY.md has
// flagged since Step 4.7/4.9: "Cart.totals is a zeroed placeholder (`EMPTY_CART_TOTALS` in
// `commands/cart.ts`) since Step 4.5 and nothing through 4.6 recomputes it."
//
// Deliberately duplicates `commands/lines.ts`'s small per-line pricing helpers (build the
// pricing context, fetch price rows, apply a snapshot, compute line totals) at this file's
// own small scope, rather than exporting and importing lines.ts's private functions — same
// precedent `lib/idempotency.ts` already set for its own `canonicalize` helper ("Mirrors
// `commands/lines.ts`'s own `canonicalJson` ... not exported there, so duplicated here at
// the same, small scope"). Keeps the dependency direction `lib -> catalog/sales services`
// only, never `lib -> commands`.

export type CartPriceChangeReason =
  | 'tier_change'
  | 'buyer_context_changed'
  | 'currency_changed'
  | 'locale_changed'
  | 'stale_snapshot'
  // Step 7.2 — §6 "on code entry or removal, cart calls [...] evaluate()": neither
  // existing reason describes "a code was just applied/removed," so
  // `cart.promotions.apply`/`.remove` (`commands/promotions.ts`) supply one of these
  // directly as `CartRepriceInput.trigger` when they internally dispatch `cart.reprice`,
  // the same way `cart.get`'s own trigger dispatch supplies `buyer_context_changed`/etc. —
  // never detected by `detectCartRepriceTrigger` (§5.2 triggers 2-4 only).
  | 'promotion_applied'
  | 'promotion_removed'
  // Step 7.3 — §7.3 "mandatory and whole-cart... exactly the case trigger 2 exists for":
  // `cart.merge`/`cart.mergeUndo` (`commands/merge.ts`) dispatch `cart.reprice` with this
  // single reason for every one of §7.1's five policy rows AND for a successful undo —
  // never detected by `detectCartRepriceTrigger` (manually supplied, same as
  // 'promotion_applied'/'promotion_removed' above). Reused for both directions (merge and
  // its undo) rather than adding a second 'merge_undo' value: the disclosure label a
  // client renders for "your identity/cart just changed because of a merge" reads
  // identically whichever direction caused it, and nothing downstream branches on this
  // string beyond attaching it to `priceChanges`/`cart.price.changed`.
  | 'merge'
  // Step 7.5 — §9 `active -> locked`: `cart.lock` "forces a whole-cart re-price" before it
  // ever checks for a still-flagged line. Manually supplied by `commands/lock.ts`'s
  // `cart.lock`, same as `'merge'`/`'promotion_applied'`/`'promotion_removed'` above —
  // never detected by `detectCartRepriceTrigger` (§5.2 triggers 2-4 only).
  | 'lock'
  // Step 8.2 (QA F12) — `commands/lines.ts`'s `cart.lines.add`/`.remove`/`.bulkAdd` undo
  // handlers dispatch `cart.reprice` as a follow-up command after restoring a reversed line
  // mutation, so `Cart.totals` (and every line's promotion-driven `discountTotalNet`) is
  // restored to its pre-mutation state too — reversing just the one line would otherwise
  // leave the whole-cart aggregate pointing at the state right before the undo, not after.
  // Manually supplied by that dispatch, same as `'merge'`/`'lock'` above — never detected by
  // `detectCartRepriceTrigger`. `cart.lines.add`/`.update`/`.remove`/`.bulkAdd` themselves
  // never use this value: their own `execute()` runs the promotions/totals phases directly
  // (`lib/promotionContext.ts`'s `buildPromotionsEffectsPhase` + this file's
  // `buildRecomputeCartTotalsPhase`) rather than dispatching a full `cart.reprice`.
  | 'undo'

export type CartPriceChange = {
  lineId: string
  productId: string
  oldUnitPriceNet: string | null
  newUnitPriceNet: string | null
  oldUnitPriceGross: string | null
  newUnitPriceGross: string | null
  reason: CartPriceChangeReason
}

type CartRepriceScope = { tenantId: string; organizationId: string }

function buildPricingContext(cart: Cart): PricingContext {
  return {
    channelId: cart.salesChannelId ?? null,
    customerId: cart.customerId ?? null,
    customerIds: cart.customerIds ?? [],
    customerGroupIds: cart.customerGroupIds,
    currencyCode: cart.currencyCode,
    priceKindId: cart.priceKindId ?? null,
    quantity: 1,
    date: new Date(),
  }
}

function buildBuyerContext(cart: Cart, quantity: number, date: Date): BuyerPricingContext {
  return {
    channelId: cart.salesChannelId ?? null,
    customerId: cart.customerId ?? null,
    customerIds: cart.customerIds ?? [],
    customerGroupIds: cart.customerGroupIds,
    currencyCode: cart.currencyCode,
    priceKindId: cart.priceKindId ?? null,
    quantity,
    date,
  }
}

/**
 * One product/variant at a time — simpler than `commands/lines.ts`'s batched
 * `fetchPriceRowsBatch` (which fetches rows for many products in one query), and
 * deliberately so: every line is already re-priced through its own `withAtomicFlush` phase
 * below (SPEC-018 — see that function's doc comment), so batching the fetch upfront would
 * not save a flush-ordering concern, only a query count, and `cart.reprice` is not a
 * hot path (triggered by a staleness/buyer-context/currency/locale drift, never on every
 * click).
 */
async function fetchLinePriceRows(
  em: EntityManager,
  scope: CartRepriceScope,
  pricingContext: PricingContext,
  productId: string,
  variantId: string | null,
): Promise<PriceRow[]> {
  const targetClause = variantId ? { $or: [{ product: productId }, { variant: variantId }] } : { product: productId }
  const where = {
    $and: [buildPriceRowFilter(pricingContext), targetClause],
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  }
  const rows = await findWithDecryption(em, CatalogProductPrice, where as never, { populate: ['priceKind', 'offer'] }, scope)
  return filterRowsForVariant(rows as unknown as PriceRow[], variantId)
}

function applyPriceSnapshot(line: CartLine, resolved: ResolvedLinePrice, pricedAt: Date): void {
  line.unitPriceNet = resolved.amountNet !== null ? String(resolved.amountNet) : null
  line.unitPriceGross = resolved.amountGross !== null ? String(resolved.amountGross) : null
  line.taxRate = resolved.taxRatePercent !== null ? String(resolved.taxRatePercent) : null
  line.priceKindId = resolved.priceRow ? resolvePriceKindId(resolved.priceRow) : null
  line.priceRowId = resolved.priceRow?.id ?? null
  line.priceTierMinQuantity = resolved.currentTier?.minQuantity ?? null
  line.pricedAt = pricedAt
}

async function computeLineTotals(
  salesCalculationService: SalesCalculationService,
  cart: Cart,
  line: CartLine,
): Promise<Record<string, unknown>> {
  const result = await salesCalculationService.calculateLine({
    documentKind: 'quote',
    line: {
      kind: 'product',
      productId: line.productId,
      productVariantId: line.variantId ?? null,
      name: line.name,
      quantity: Number(line.quantity),
      currencyCode: cart.currencyCode,
      unitPriceNet: line.unitPriceNet !== null ? Number(line.unitPriceNet) : null,
      unitPriceGross: line.unitPriceGross !== null ? Number(line.unitPriceGross) : null,
      taxRate: line.taxRate !== null ? Number(line.taxRate) : null,
      configuration: line.configuration ?? null,
    },
    context: { tenantId: cart.tenantId, organizationId: cart.organizationId, currencyCode: cart.currencyCode },
  })
  return result as unknown as Record<string, unknown>
}

/**
 * One `withAtomicFlush` phase per line. `catalogBuyerPricingService.resolveLinePrice` may
 * itself run an `EntityManager` read (e.g. a `SalesTaxRate` fallback lookup, per that
 * service's own header comment), so an earlier line's mutation must be flushed before a
 * later line's read runs on the same `em` — the identical hazard, and the identical
 * per-entry-phase fix, as `commands/lines.ts`'s `bulkAddLinesCommand`.
 *
 * A line whose product no longer resolves a price row at all (withdrawn mid-cart) is left
 * with its last-known snapshot untouched, rather than blanked or removed — open item, not
 * in this step's scope: §5.2 names the four triggers that force a re-price, not what a
 * re-price itself should do when it cannot find a price.
 *
 * Mutates `changes`/`touched` in place (same outer-closure-collects-across-phases
 * convention `bulkAddLinesCommand` already uses) so the caller can emit side effects and
 * build the `priceChanges` disclosure after the whole atomic flush commits.
 */
export function buildCartLineRepricePhases(
  em: EntityManager,
  container: { resolve: <T = unknown>(name: string) => T },
  cart: Cart,
  lines: CartLine[],
  reason: CartPriceChangeReason,
  now: Date,
  changes: CartPriceChange[],
  touched: CartLine[],
): Array<() => Promise<void>> {
  const scope: CartRepriceScope = { tenantId: cart.tenantId, organizationId: cart.organizationId }
  const buyerPricingService = container.resolve<CatalogBuyerPricingService>('catalogBuyerPricingService')
  const salesCalculationService = container.resolve<SalesCalculationService>('salesCalculationService')
  const pricingContext = buildPricingContext(cart)

  // Step 7.1 — §4.2/§6a.2: a flagged line is excluded from re-pricing (same reasoning as the
  // totals/evaluate exclusion below — it is not for sale right now). A `promotion`-origin
  // (gift) line is excluded too: it carries a deliberate `unitPriceNet/Gross: '0'` snapshot
  // set by the promotions phase, never a catalog-resolved price — running it through this
  // engine would silently overwrite "free" with whatever the underlying product's real
  // catalog price happens to be on the very next re-price trigger.
  //
  // `origin !== 'promotion'` is filtered EAGERLY here, at this function's own call time —
  // safe, since no phase ordered before this one in `cart.reprice`'s sequence ever creates a
  // gift line (`buildPromotionsEffectsPhase` always runs AFTER these phases). `flagState`
  // is NOT filtered here, eagerly — see the per-line check inside the mapped closure below.
  const eligibleLines = lines.filter((line) => line.origin !== 'promotion')

  return eligibleLines.map((line) => async () => {
    // Step 7.4 — §6a.2: checked again HERE, at this line's own EXECUTION time, rather than
    // only by an eager filter above — a line the whole-cart re-visibility pass (an earlier
    // phase in the SAME `withAtomicFlush` sequence) just flagged THIS cycle must be excluded
    // from re-pricing too, and that pass's mutation only takes effect once ITS OWN phase
    // actually runs, which is after `buildCartLineRepricePhases` itself was already called
    // (phases are all constructed up front, before `withAtomicFlush` executes any of them).
    if (line.flagState != null) return
    const rows = await fetchLinePriceRows(em, scope, pricingContext, line.productId, line.variantId ?? null)
    const quantity = Number(line.quantity)
    const resolved = await buyerPricingService.resolveLinePrice(em, rows, buildBuyerContext(cart, quantity, now), scope)
    if (!resolved.priceRow) return

    const oldNet = line.unitPriceNet ?? null
    const oldGross = line.unitPriceGross ?? null
    applyPriceSnapshot(line, resolved, now)
    line.lineTotals = await computeLineTotals(salesCalculationService, cart, line)
    touched.push(line)

    const newNet = line.unitPriceNet ?? null
    const newGross = line.unitPriceGross ?? null
    if (oldNet !== newNet || oldGross !== newGross) {
      changes.push({
        lineId: line.id,
        productId: line.productId,
        oldUnitPriceNet: oldNet,
        newUnitPriceNet: newNet,
        oldUnitPriceGross: oldGross,
        newUnitPriceGross: newGross,
        reason,
      })
    }
  })
}

/**
 * §3.2 — maps a (freshly re-priced) `CartLine` onto the `SalesLineSnapshot` shape
 * `salesCalculationService.calculateDocumentTotals` consumes. `discountAmountBasis: 'line'`
 * is set only when `discountTotalNet` is actually populated (rule 1, §3.2) — no promotion
 * lines exist yet in this worktree (Phase 3 integrates `promotionsService`), so this is
 * always `null` today, but the mapping already follows the rule rather than deferring it.
 */
export function toCartTotalsLineSnapshot(line: CartLine, currencyCode: string): SalesLineSnapshot {
  const discountAmount = line.discountTotalNet !== null ? Math.abs(Number(line.discountTotalNet)) : null
  return {
    kind: 'product',
    productId: line.productId,
    productVariantId: line.variantId ?? null,
    name: line.name,
    quantity: Number(line.quantity),
    quantityUnit: line.quantityUnit ?? null,
    currencyCode,
    unitPriceNet: line.unitPriceNet !== null ? Number(line.unitPriceNet) : null,
    unitPriceGross: line.unitPriceGross !== null ? Number(line.unitPriceGross) : null,
    discountAmount,
    discountAmountBasis: discountAmount !== null ? 'line' : null,
    taxRate: line.taxRate !== null ? Number(line.taxRate) : null,
    configuration: line.configuration ?? null,
  }
}

/**
 * The final `withAtomicFlush` phase: recomputes `Cart.totals` as a REAL whole-cart
 * aggregate via `salesCalculationService.calculateDocumentTotals` (§3.2) — "the cart stores
 * the returned totals verbatim. It does not round, re-sum or adjust them" — and sets
 * `totalsComputedAt`/`lastPriceChangeAt`.
 *
 * `adjustments` (Step 7.1, default `[]` so every pre-existing caller is unaffected) carries
 * order-scope `SalesAdjustmentDraft`s — today only `CART_DISCOUNT` effects the promotions
 * phase collected earlier in the same `withAtomicFlush` sequence.
 *
 * `lines` is filtered to `flagState == null` here (not by the caller) so this is the one
 * place that ever has to remember a flagged line is excluded from totals (§4.2/§6a.2) —
 * mirrors `buildCartLineRepricePhases`'s own defensive filter above.
 */
export function buildRecomputeCartTotalsPhase(
  container: { resolve: <T = unknown>(name: string) => T },
  cart: Cart,
  lines: CartLine[],
  now: Date,
  changes: CartPriceChange[],
  adjustments: SalesAdjustmentDraft[] = [],
): () => Promise<void> {
  return async () => {
    const salesCalculationService = container.resolve<SalesCalculationService>('salesCalculationService')
    const pricableLines = lines.filter((line) => line.flagState == null)
    const result = await salesCalculationService.calculateDocumentTotals({
      documentKind: 'quote',
      lines: pricableLines.map((line) => toCartTotalsLineSnapshot(line, cart.currencyCode)),
      adjustments,
      context: {
        tenantId: cart.tenantId,
        organizationId: cart.organizationId,
        currencyCode: cart.currencyCode,
        metadata: { source: 'cart', cartId: cart.id },
      },
    })
    cart.totals = result.totals as unknown as Record<string, unknown>
    cart.totalsComputedAt = now
    if (changes.length > 0) cart.lastPriceChangeAt = now
  }
}
