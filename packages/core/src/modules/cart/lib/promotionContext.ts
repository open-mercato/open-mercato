import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CatalogProduct, CatalogProductVariant } from '@open-mercato/core/modules/catalog/data/entities'
import type { ScopedProductScope } from '@open-mercato/core/modules/catalog/services/catalogScopedProductService'
import type { SalesCalculationService } from '@open-mercato/core/modules/sales/services/salesCalculationService'
import type { SalesAdjustmentDraft } from '@open-mercato/core/modules/sales/lib/types'
import { CodeReservation } from '@open-mercato/core/modules/promotions/data/entities'
import type {
  AddFreeItemEffect,
  BuyerContext,
  CartDiscountEffect,
  CodeRef,
  EvaluateItem,
  LineDiscountEffect,
  PromotionsService,
  ResolvedEffect,
} from '@open-mercato/core/modules/promotions/lib/types'
import { Cart, CartLine, CartPromotionApplication } from '../data/entities'
import { cartVisibilityKey, evaluateCartVisibility, isVisible } from './visibility'
import type { CartVisibilityResult, ResolvedAssortmentScope } from './visibility'

// Step 7.1 — the promotions integration phase behind `cart.reprice` (§6/§6a of
// `.ai/specs/2026-08-14-cart-module.md`). DELIVERY_DISCOUNT effects are silently
// dropped (D-R4-14/§6: the cart never sends delivery context, so the engine should
// never return one; a defensive filter rather than an assertion that throws if it
// ever does).
//
// Step 7.2 — `codes` is no longer hardcoded `[]`. It is derived from this cart's own
// `CartPromotionApplication` rows that carry a `codeId` (an ENTERED code — see the long
// comment on the sync loop below for why that distinction matters), and every such row
// also gets its reservation extended ("cart activity", D-R4-8) before `evaluate()` runs,
// with a lapsed one dropped from `codes` and the row removed with a
// `promotion_no_longer_valid` warning. `cart.promotions.apply` is the one place a NEW
// code-bearing row is created (its own placeholder, persisted in its own transaction
// before this phase's caller — `cart.reprice` — ever runs), so by the time this phase
// reads `CartPromotionApplication` a just-applied code is already there.
//
// SPEC-018 discipline (`packages/core/AGENTS.md` — "Entity Update Safety"): this phase's
// body is split into a READ section (the code housekeeping below, `promotionsService.evaluate()`,
// the gift-line visibility batch check, the product/variant/line-numbering fetches — every
// one of them a query against the SAME forked `em` the caller's earlier phases already
// mutated) followed by a MUTATE section (line discount amounts, gift-line create/remove,
// the CartPromotionApplication sync). No query runs after any mutation inside this phase —
// an interleaved read would silently drop the earlier scalar changes under MikroORM v7.
// `promotionsService.extendReservation()`/the `CodeReservation` existence check below are
// the one exception worth calling out explicitly: they run against promotions' OWN
// `EntityManager` fork (`extendReservation`'s own `resolvePromotionsEm`) or a read-only
// query on THIS `em` before any mutation — neither one is a read-after-mutate hazard on
// this phase's own `em`.

/**
 * Maps a `CartLine` onto `promotions`' `EvaluateItem` contract (§6: "sends only what the
 * cart knows: ids, prices and quantities"). `priceIsPromotional` is hardcoded `false` —
 * D-R4-16 names this per-item signal, but nothing upstream of `cart` (catalog pricing,
 * `ResolvedLinePrice`) currently populates "this unit price came from a promotional price
 * kind" anywhere in this worktree (checked). That is a gap for whoever wires catalog
 * promotional pricing into this field later, not this step's job to invent.
 */
export function toPromotionCartLine(line: CartLine): EvaluateItem {
  return {
    lineId: line.id,
    productId: line.productId,
    variantId: line.variantId ?? null,
    quantity: line.quantity,
    unitPriceNet: line.unitPriceNet ?? '0',
    unitPriceGross: line.unitPriceGross ?? '0',
    priceIsPromotional: false,
  }
}

export type CartPromotionWarning =
  | { code: 'product_unavailable'; productId: string; variantId: string | null }
  // Step 7.2 — D-R4-8: "the cart extends on activity and emits `cart.promotion.no_longer_valid`
  // plus a warning when a reservation lapses." Broadened the union rather than adding a
  // sibling type (judgment call) — every existing consumer of `CartPromotionWarning`
  // (`CartRepriceResult.warnings`, `lib/cartView.ts`'s eventual warnings merge) already
  // treats it as one flat array, and a `code`-discriminated union reads naturally there.
  | { code: 'promotion_no_longer_valid'; promotionId: string }

type CartPromotionsContainer = {
  resolve: <T = unknown>(name: string) => T
}

/**
 * `effect.label` is a `Record<string, string>` i18n map (SPEC-055 §Public TypeScript
 * Contract) with no contract-mandated key to prefer. Judgment call: try the cart's own
 * locale verbatim, then its language subtag (`en-US` -> `en`), then fall back to whatever
 * key happens to be first — never throw for a promotion authored without the buyer's
 * locale. `null` only when the map itself is empty.
 */
function pickEffectLabel(labels: Record<string, string>, locale: string): string | null {
  if (labels[locale]) return labels[locale]
  const [language] = locale.split('-')
  if (language && labels[language]) return labels[language]
  const values = Object.values(labels)
  return values.length > 0 ? values[0] : null
}

function giftLineKey(promotionId: string, productId: string, variantId: string | null): string {
  return `${promotionId}:${productId}:${variantId ?? ''}`
}

type ApplicationEntry = {
  cartLineId: string | null
  effect: ResolvedEffect
  amountNet: string | null
  amountGross: string | null
}

/** Step 7.2 — carried from an existing code-bearing row onto whatever row(s) the current
 * evaluation re-derives for the SAME promotion, so a promotion's code linkage survives its
 * effect moving to a different line (or appearing for the first time this cycle) instead
 * of being silently nulled out by a fresh `em.create()`. */
type CodeLinkage = {
  code: string | null
  codeId: string | null
  codeType: string | null
  codeReservationId: string | null
}

const NO_CODE_LINKAGE: CodeLinkage = { code: null, codeId: null, codeType: null, codeReservationId: null }

export type BuildPromotionsEffectsPhaseParams = {
  em: EntityManager
  container: CartPromotionsContainer
  cart: Cart
  /**
   * The cart's full non-deleted `CartLine` set. Mutated in place: a newly created gift line
   * is pushed on; a gift line no longer present in this evaluation is spliced out (after its
   * own `deletedAt` is set) — so a later phase in the SAME `withAtomicFlush` sequence that
   * closes over this same array (the totals recompute) sees the current, post-promotion set
   * without a second DB round trip.
   */
  lines: CartLine[]
  assortmentScope: ResolvedAssortmentScope | undefined
  tenantScope: ScopedProductScope
  now: Date
  /** `CART_DISCOUNT` effects are pushed here as order-scope `SalesAdjustmentDraft`s. */
  adjustments: SalesAdjustmentDraft[]
  /** A rejected `ADD_FREE_ITEM` (assortment-unavailable gift) or a lapsed code reservation
   * is pushed here (§6a.3 / D-R4-8). */
  warnings: CartPromotionWarning[]
  /** Newly created gift `CartLine`s, for the caller's post-commit side effects. */
  createdGiftLines: CartLine[]
  /** Gift `CartLine`s removed because their promotion no longer applies, same reason. */
  removedGiftLines: CartLine[]
}

/**
 * Builds the ONE `withAtomicFlush` phase that: calls `promotionsService.evaluate()` against
 * the cart's non-flagged, non-gift lines (and its own currently-held, still-reserved codes —
 * Step 7.2); maps `LINE_DISCOUNT` onto `CartLine.discountTotalNet` and `CART_DISCOUNT` onto
 * `adjustments`; creates/removes `ADD_FREE_ITEM` gift lines (assortment-checked, buyer-immutable
 * per `commands/lines.ts`'s existing `promotion_line_immutable` guard); drops `DELIVERY_DISCOUNT`;
 * extends every held code's reservation ("cart activity", D-R4-8); and syncs
 * `CartPromotionApplication` rows to the current evaluation.
 *
 * Caller contract (`commands/cart.ts`'s `cart.reprice`): `container` must already have `auth`
 * registered (`{ tenantId, orgId }`) before this phase runs, or `promotionsService.evaluate()`/
 * `.extendReservation()` fail closed with a 400 (`lib/promotions-service.ts`'s
 * `resolvePromotionsServiceScope`/`resolvePromotionsServiceAuthAndScope`).
 */
export function buildPromotionsEffectsPhase(params: BuildPromotionsEffectsPhaseParams): () => Promise<void> {
  const { em, container, cart, lines, assortmentScope, tenantScope, now, adjustments, warnings, createdGiftLines, removedGiftLines } = params

  return async () => {
    const promotionsService = container.resolve<PromotionsService>('promotionsService')
    const salesCalculationService = container.resolve<SalesCalculationService>('salesCalculationService')

    // ---- READ section part 1: this cart's currently-held codes, BEFORE evaluate() (its
    // `codes` input is derived from this), extended + lapse-checked ("cart activity extends
    // a reservation", D-R4-8) ----
    const existingApplications = (await findWithDecryption(
      em,
      CartPromotionApplication,
      { cartId: cart.id, tenantId: cart.tenantId, organizationId: cart.organizationId },
      {},
      { tenantId: cart.tenantId, organizationId: cart.organizationId },
    )) as CartPromotionApplication[]

    const codeIdsInUse = Array.from(
      new Set(existingApplications.map((application) => application.codeId).filter((id): id is string => !!id)),
    )
    // A code-id's reservation lives on `promotions`' own tables, not this cart's `em` — so
    // extending it and then re-checking it still exists is two round trips against a
    // DIFFERENT EntityManager (`extendReservation`'s own `resolvePromotionsEm` fork) plus a
    // plain cross-module read on THIS `em`, never a read-after-mutate hazard on this phase's
    // own pending changes (there are none yet at this point in the phase).
    const lapsedCodeIds = new Set<string>()
    for (const codeId of codeIdsInUse) {
      await promotionsService.extendReservation(codeId, cart.id)
      const stillReserved = await em.findOne(CodeReservation, {
        codeId,
        cartId: cart.id,
        tenantId: tenantScope.tenantId,
        organizationId: tenantScope.organizationId,
      })
      if (!stillReserved) lapsedCodeIds.add(codeId)
    }

    // One `CodeRef` per distinct, still-reserved codeId — a promotion with a per-line
    // benefit can have several `CartPromotionApplication` rows sharing the same `codeId`
    // (one per target line), so this dedupes rather than sending duplicates to `evaluate()`.
    const codesByCodeId = new Map<string, CodeRef>()
    const codeLinkageByPromotion = new Map<string, CodeLinkage>()
    for (const application of existingApplications) {
      if (!application.codeId) continue
      if (!lapsedCodeIds.has(application.codeId)) {
        codesByCodeId.set(application.codeId, {
          id: application.codeId,
          type: (application.codeType ?? 'static') as 'static' | 'dynamic',
        })
      }
      // Step 7.2 — captured regardless of lapsed status: a lapsed code's OWN rows are
      // removed below (never re-created), so there is nothing to carry linkage onto for it;
      // harmless to still index it here since `appliedPromotionIds` can never include a
      // promotion whose only code just lapsed and was excluded from `codes` above.
      if (!codeLinkageByPromotion.has(application.promotionId)) {
        codeLinkageByPromotion.set(application.promotionId, {
          code: application.code ?? null,
          codeId: application.codeId,
          codeType: application.codeType ?? null,
          codeReservationId: application.codeReservationId ?? null,
        })
      }
    }
    const codes = Array.from(codesByCodeId.values())

    // §4.2/§6a.2: a flagged line is excluded from evaluation. Gift lines are evaluator
    // OUTPUT, not input — re-evaluating them as purchasable items would double-count.
    const evaluableLines = lines.filter((line) => line.flagState == null && line.origin !== 'promotion')
    const buyer: BuyerContext = {
      customerId: cart.customerId ?? null,
      customerIds: cart.customerIds ?? [],
      customerGroupIds: cart.customerGroupIds,
    }

    const result = await promotionsService.evaluate({
      items: evaluableLines.map(toPromotionCartLine),
      currency: cart.currencyCode,
      evaluatedAt: now.toISOString(),
      buyer,
      // Neither field has a resolvable source in `cart` yet (no order-history lookup, no
      // weight aggregation) — `null` is correct per the type, not a shortcut. Revisit if a
      // rule a test fixture exercises turns out to gate on either field.
      customerOrderCount: null,
      cartWeight: null,
      codes,
    })

    // ---- Pure in-memory classification of the result (no `em` access yet) ----
    const lineById = new Map(lines.map((line) => [line.id, line]))
    const lineDiscountTargets: Array<{ promotionId: string; line: CartLine; effect: LineDiscountEffect }> = []
    const cartDiscountEntries: Array<{ promotionId: string; effect: CartDiscountEffect }> = []
    const freeItemEffects: Array<{ promotionId: string; effect: AddFreeItemEffect }> = []

    for (const applied of result.appliedPromotions) {
      for (const effect of applied.effects) {
        if (effect.type === 'LINE_DISCOUNT') {
          const target = lineById.get(effect.targetLineId)
          if (target) lineDiscountTargets.push({ promotionId: applied.promotionId, line: target, effect })
        } else if (effect.type === 'CART_DISCOUNT') {
          cartDiscountEntries.push({ promotionId: applied.promotionId, effect })
        } else if (effect.type === 'ADD_FREE_ITEM') {
          freeItemEffects.push({ promotionId: applied.promotionId, effect })
        }
        // `DELIVERY_DISCOUNT` — dropped (D-R4-14/§6): never mapped to anything.
      }
    }

    const existingGiftLines = lines.filter((line) => line.origin === 'promotion')
    const existingGiftByKey = new Map(
      existingGiftLines.map((line) => [giftLineKey(line.promotionId as string, line.productId, line.variantId ?? null), line]),
    )
    const keepKeys = new Set(
      freeItemEffects.map(({ promotionId, effect }) => giftLineKey(promotionId, effect.productId, effect.variantId ?? null)),
    )
    const giftLinesToRemove = Array.from(existingGiftByKey.entries())
      .filter(([key]) => !keepKeys.has(key))
      .map(([, line]) => line)
    const newFreeItemEffects = freeItemEffects.filter(
      ({ promotionId, effect }) => !existingGiftByKey.has(giftLineKey(promotionId, effect.productId, effect.variantId ?? null)),
    )

    // ---- READ section part 2: every remaining `em` query this phase needs, before any
    // mutation below ----
    let visibility: CartVisibilityResult = new Map()
    let productsById = new Map<string, CatalogProduct>()
    let variantsById = new Map<string, CatalogProductVariant>()
    let nextLineNumber = 0
    if (newFreeItemEffects.length > 0) {
      const visibilityRefs = newFreeItemEffects.map(({ effect }) => ({ productId: effect.productId, variantId: effect.variantId ?? null }))
      visibility = await evaluateCartVisibility({ lines: visibilityRefs, scope: assortmentScope, tenantScope, em, container })

      const productIds = Array.from(new Set(newFreeItemEffects.map(({ effect }) => effect.productId)))
      const products = (await findWithDecryption(
        em,
        CatalogProduct,
        { id: { $in: productIds }, tenantId: tenantScope.tenantId, organizationId: tenantScope.organizationId, deletedAt: null },
        {},
        tenantScope,
      )) as CatalogProduct[]
      productsById = new Map(products.map((product) => [product.id, product]))

      const variantIds = Array.from(
        new Set(newFreeItemEffects.map(({ effect }) => effect.variantId).filter((id): id is string => !!id)),
      )
      if (variantIds.length > 0) {
        const variants = (await findWithDecryption(
          em,
          CatalogProductVariant,
          { id: { $in: variantIds }, tenantId: tenantScope.tenantId, organizationId: tenantScope.organizationId, deletedAt: null },
          {},
          tenantScope,
        )) as CatalogProductVariant[]
        variantsById = new Map(variants.map((variant) => [variant.id, variant]))
      }

      // Mirrors `commands/lines.ts`'s `computeStartingLineNumber` exactly (plain `em.find`,
      // no decryption wrapper — `CartLine` carries no encrypted columns): includes
      // soft-deleted lines too, so a freshly minted gift line never reuses a retired number.
      const allLinesForNumbering = await em.find(CartLine, {
        cartId: cart.id,
        tenantId: tenantScope.tenantId,
        organizationId: tenantScope.organizationId,
      })
      nextLineNumber = allLinesForNumbering.reduce((max, line) => Math.max(max, line.lineNumber), 0) + 1
    }

    // ---- MUTATE section: no more `em` reads past this point in this phase ----
    // Step 8.2 (QA F12) — every evaluated line's discount is re-derived from THIS
    // evaluation, not merged with its previous one: a line that dropped out of
    // `lineDiscountTargets` since the last evaluation (e.g. its quantity just fell below the
    // promotion's own "2+ items" threshold) must lose its stale `discountTotalNet`, not keep
    // whatever a PRIOR evaluation last wrote. Clearing every `evaluableLine` first, then
    // reapplying below for whatever is still targeted, makes that hold unconditionally
    // without a second lookup of which lines changed.
    for (const line of evaluableLines) {
      if (line.discountTotalNet !== null) line.discountTotalNet = null
    }
    for (const { line, effect } of lineDiscountTargets) {
      line.discountTotalNet = effect.amountNet
    }

    for (const giftLine of giftLinesToRemove) {
      giftLine.deletedAt = now
      const index = lines.indexOf(giftLine)
      if (index >= 0) lines.splice(index, 1)
      removedGiftLines.push(giftLine)
    }

    const createdGiftLineByKey = new Map<string, CartLine>()
    for (const { promotionId, effect } of newFreeItemEffects) {
      const ref = { productId: effect.productId, variantId: effect.variantId ?? null }
      const visible = isVisible(visibility.get(cartVisibilityKey(ref)) ?? 'unavailable')
      if (!visible) {
        warnings.push({ code: 'product_unavailable', productId: effect.productId, variantId: effect.variantId ?? null })
        continue
      }
      const product = productsById.get(effect.productId) ?? null
      if (!product) {
        // §6a.3: a restricted product and a missing one collapse to the same outcome.
        warnings.push({ code: 'product_unavailable', productId: effect.productId, variantId: effect.variantId ?? null })
        continue
      }
      const variant = effect.variantId ? variantsById.get(effect.variantId) ?? null : null

      // §4.2: `lineTotals` is "verbatim SalesLineCalculationResult" for every line, free
      // gift included — never a placeholder `{}` (that would ship a line whose own total
      // snapshot lies about having one). All-zero amounts in, all-zero amounts out.
      const giftLineTotals = await salesCalculationService.calculateLine({
        documentKind: 'quote',
        line: {
          kind: 'product',
          productId: product.id,
          productVariantId: variant?.id ?? null,
          name: product.title,
          quantity: effect.quantity,
          currencyCode: cart.currencyCode,
          unitPriceNet: 0,
          unitPriceGross: 0,
          taxRate: null,
          configuration: null,
        },
        context: { tenantId: cart.tenantId, organizationId: cart.organizationId, currencyCode: cart.currencyCode },
      })

      const giftLine = em.create(CartLine, {
        organizationId: cart.organizationId,
        tenantId: cart.tenantId,
        cartId: cart.id,
        lineNumber: nextLineNumber,
        productId: product.id,
        variantId: variant?.id ?? null,
        sku: variant?.sku ?? product.sku ?? null,
        name: product.title,
        optionValues: variant?.optionValues ?? null,
        quantity: String(effect.quantity),
        unitPriceNet: '0',
        unitPriceGross: '0',
        taxRate: null,
        origin: 'promotion' as const,
        promotionId,
        discountTotalNet: null,
        flagState: null,
        configuration: null,
        addedByActorType: 'system' as const,
        addedByActorId: null,
        metadata: null,
        pricedAt: now,
        lineTotals: giftLineTotals as unknown as Record<string, unknown>,
      })
      nextLineNumber += 1
      em.persist(giftLine)
      lines.push(giftLine)
      createdGiftLines.push(giftLine)
      createdGiftLineByKey.set(giftLineKey(promotionId, effect.productId, effect.variantId ?? null), giftLine)
    }

    // ---- Build the (promotionId -> applications) map now that every line mutation above
    // has resolved (gift lines created, discounts applied) — pure in-memory, no `em` access.
    const applicationsByPromotion = new Map<string, ApplicationEntry[]>()
    const pushApplication = (promotionId: string, entry: ApplicationEntry): void => {
      const entries = applicationsByPromotion.get(promotionId) ?? []
      entries.push(entry)
      applicationsByPromotion.set(promotionId, entries)
    }

    for (const { promotionId, line, effect } of lineDiscountTargets) {
      pushApplication(promotionId, { cartLineId: line.id, effect, amountNet: effect.amountNet, amountGross: effect.amountGross })
    }
    for (const { promotionId, effect } of cartDiscountEntries) {
      adjustments.push({
        scope: 'order',
        kind: 'discount',
        promotionId,
        amountNet: Number(effect.amountNet),
        amountGross: Number(effect.amountGross),
        currencyCode: effect.currency,
        label: pickEffectLabel(effect.label, cart.locale),
      })
      pushApplication(promotionId, { cartLineId: null, effect, amountNet: effect.amountNet, amountGross: effect.amountGross })
    }
    for (const { promotionId, effect } of newFreeItemEffects) {
      const createdLine = createdGiftLineByKey.get(giftLineKey(promotionId, effect.productId, effect.variantId ?? null))
      // A rejected gift (visibility/missing product) never got a line — no application row.
      if (!createdLine) continue
      pushApplication(promotionId, { cartLineId: createdLine.id, effect, amountNet: null, amountGross: null })
    }

    // ---- Sync `CartPromotionApplication` rows to the current evaluation (mutations only:
    // `existingApplications` was already fetched in the READ section above) ----
    //
    // Step 7.2 — THE KEY DESIGN DECISION (documented here, not just in the run's own
    // notes, since this is the single most load-bearing piece of reasoning in this phase):
    // `CartPromotionApplication.promotionId` is NOT NULL, and Step 7.1's original sync
    // logic removed ANY row whose `promotionId` was absent from this evaluation's
    // `appliedPromotions` — correct for an AUTOMATIC (codeless) promotion, where "absent
    // from the result" really does mean "no longer applies, forget it." It is WRONG for a
    // CODE-bearing row: a code that reserves successfully but whose promotion's rule tree
    // does not currently match the cart's composition (e.g. a minimum-cart-value rule) also
    // comes back absent from `appliedPromotions` — not because the code was removed, but
    // because the rule simply does not match RIGHT NOW. Deleting that row on the very first
    // re-price after applying the code would erase the only record the code was ever
    // entered; the next re-price would feed `evaluate()` a `codes` list with nothing left to
    // rebuild it from, and the code is lost even though the buyer never removed it and the
    // reservation is still live.
    //
    // The fix: a row with a non-null `codeId` is "an entered code," not merely "a currently-
    // active discount." It is removed ONLY by (a) this phase's own lapsed-reservation check
    // above (the code itself is gone), or (b) an explicit `cart.promotions.remove`
    // (`commands/promotions.ts`) — never by this automatic sync just because its promotion
    // produced no effect THIS cycle. When that happens, the row survives with its effect
    // zeroed out (`effect: {}`, `amountNet`/`amountGross`: null, `cartLineId: null` — it no
    // longer points at a specific line because it is not discounting one) rather than being
    // deleted. A codeless (automatic) row keeps Step 7.1's exact original behavior: pruned
    // whenever its promotion is absent from the result.
    //
    // Removal is otherwise still keyed on (promotionId, cartLineId), not promotionId alone:
    // a promotion that stays applied but whose effect now targets a different line (or
    // switched which product it gifts) must drop its OLD row, not just leave it orphaned
    // pointing at a line that is no longer part of this evaluation — a FRESH row for the
    // same promotion is created in the loop below, with its code linkage (if any) carried
    // over via `codeLinkageByPromotion` so a promotion's code binding survives its effect
    // moving between lines.
    const appliedPromotionIds = new Set(result.appliedPromotions.map((applied) => applied.promotionId))
    const keepApplicationKeys = new Set<string>()
    for (const [promotionId, entries] of applicationsByPromotion) {
      for (const entry of entries) {
        keepApplicationKeys.add(`${promotionId}:${entry.cartLineId ?? ''}`)
      }
    }
    for (const existingApplication of existingApplications) {
      const codeId = existingApplication.codeId ?? null

      if (codeId != null && lapsedCodeIds.has(codeId)) {
        // The reservation backing this entered code is gone (expired, or released by a
        // promotions-side sweep) — D-R4-8's "emits `cart.promotion.no_longer_valid` plus a
        // warning when a reservation lapses". Removed unconditionally, even if this
        // promotion happens to still match THIS evaluation via some other, code-independent
        // rule — the ENTERED CODE itself is gone either way.
        em.remove(existingApplication)
        warnings.push({ code: 'promotion_no_longer_valid', promotionId: existingApplication.promotionId })
        continue
      }

      const key = `${existingApplication.promotionId}:${existingApplication.cartLineId ?? ''}`
      if (appliedPromotionIds.has(existingApplication.promotionId) && keepApplicationKeys.has(key)) {
        // Still current — the update loop below will refresh its amounts in place.
        continue
      }

      if (!appliedPromotionIds.has(existingApplication.promotionId) && codeId != null) {
        // THE KEY DESIGN DECISION above: keep the entered-code row, zero its effect.
        existingApplication.effect = {} as Record<string, unknown>
        existingApplication.amountNet = null
        existingApplication.amountGross = null
        existingApplication.cartLineId = null
        continue
      }

      em.remove(existingApplication)
    }

    for (const [promotionId, entries] of applicationsByPromotion) {
      for (const entry of entries) {
        const matched = existingApplications.find(
          (application) =>
            application.promotionId === promotionId && (application.cartLineId ?? null) === entry.cartLineId,
        )
        if (matched) {
          matched.amountNet = entry.amountNet
          matched.amountGross = entry.amountGross
          matched.effect = entry.effect as unknown as Record<string, unknown>
          matched.appliedAt = now
          continue
        }
        // Step 7.2 — a NEW row for a promotion that already had a code-bearing row under a
        // DIFFERENT key (e.g. its `LINE_DISCOUNT` target moved to another line) carries that
        // code's linkage forward; a promotion with no held code gets `NO_CODE_LINKAGE`,
        // exactly Step 7.1's original behavior.
        const linkage = codeLinkageByPromotion.get(promotionId) ?? NO_CODE_LINKAGE
        const application = em.create(CartPromotionApplication, {
          organizationId: cart.organizationId,
          tenantId: cart.tenantId,
          cartId: cart.id,
          promotionId,
          code: linkage.code,
          codeId: linkage.codeId,
          codeType: linkage.codeType,
          codeReservationId: linkage.codeReservationId,
          scope: entry.cartLineId ? ('line' as const) : ('order' as const),
          cartLineId: entry.cartLineId,
          effect: entry.effect as unknown as Record<string, unknown>,
          amountNet: entry.amountNet,
          amountGross: entry.amountGross,
          appliedAt: now,
        })
        em.persist(application)
      }
    }

    // §4.1's own column exists but nothing reads it yet (checked `lib/cartView.ts` — no
    // `promotionEffects` consumer today beyond `commands/cart.ts`'s `toCartSummary` passing
    // it through verbatim). Stored raw rather than a trimmed projection so a future badge UI
    // has the full `appliedPromotions` shape to read from, same "found and closed before
    // anyone needed it" style this run's earlier steps use for a half-wired field.
    cart.promotionEffects = result.appliedPromotions
  }
}
