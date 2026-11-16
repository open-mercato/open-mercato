// Public TypeScript contract (SPEC-055 §Public TypeScript Contract, rev 9 — W6) plus the
// evaluation-engine-internal normalized shapes (SPEC-055 §Normalized Promotion Shape) and
// an orchestration-only `EvaluationContext` this module's own `lib/*` files thread through
// a single evaluate() call.
//
// Everything under "Public TypeScript Contract" below is frozen the moment Phase 1 ships
// (SPEC-055 §Release 4 Contract Freeze) — `cart` and any other in-process caller import
// these types verbatim from `@open-mercato/core/modules/promotions/lib/types`. Do not
// rename or restructure field names, optionality, or literal unions without following the
// deprecation protocol in `BACKWARD_COMPATIBILITY.md`.

// ---------------------------------------------------------------------------
// Public TypeScript Contract (rev 9 — new, W6)
// ---------------------------------------------------------------------------

// Identity (D-R4-28)
export interface BuyerContext {
  customerId: string | null        // the winning identity (person wins, D3/D3a)
  customerIds: string[]            // order history, per-customer limits
  customerGroupIds: string[]
}

export interface CodeRef { id: string; type: 'static' | 'dynamic' }

// evaluate (D-R4-9, D-R4-10, D-R4-13, D-R4-21, D-R4-28)
export interface EvaluateItem {
  lineId: string
  productId: string
  variantId: string | null
  quantity: string
  unitPriceNet: string
  unitPriceGross: string
  priceIsPromotional: boolean      // D-R4-16
}

export interface EvaluateInput {
  items: EvaluateItem[]
  currency: string
  evaluatedAt: string              // ISO 8601 — D-R4-13
  buyer: BuyerContext
  customerOrderCount: number | null
  cartWeight: string | null
  codes: CodeRef[]
}

export type EffectBasis = 'net' | 'gross'

export interface ResolvedEffectBase {
  type: 'LINE_DISCOUNT' | 'CART_DISCOUNT' | 'DELIVERY_DISCOUNT' | 'ADD_FREE_ITEM'
  appliesTo: 'order' | 'line' | 'unit'
  currency: string
  label: Record<string, string>
}

export interface LineDiscountEffect extends ResolvedEffectBase {
  type: 'LINE_DISCOUNT'
  targetLineId: string
  targetProductId: string
  targetVariantId: string | null
  lineQuantity: number
  appliedQuantity: number
  amountNet: string                // negative decimal string
  amountGross: string
  basis: EffectBasis                // audit only — D-R4-10
}

export interface CartDiscountEffect extends ResolvedEffectBase {
  type: 'CART_DISCOUNT'
  amountNet: string
  amountGross: string
  basis: EffectBasis
}

export interface DeliveryDiscountEffect extends ResolvedEffectBase {
  type: 'DELIVERY_DISCOUNT'       // defined; unreachable in Release 4 (D-R4-14)
  deliveryMethodCode: string
  amountNet: string
  amountGross: string
  basis: EffectBasis
}

export interface AddFreeItemEffect extends ResolvedEffectBase {
  type: 'ADD_FREE_ITEM'
  productId: string
  variantId: string | null
  quantity: number
  reason: 'FREE_PRODUCT' | 'BUY_X_GET_Y'
  promotionId: string              // D-R4-7 marker, matches cart-module.md CartLine.promotion_id
}

export type ResolvedEffect = LineDiscountEffect | CartDiscountEffect | DeliveryDiscountEffect | AddFreeItemEffect

export interface AppliedPromotion { promotionId: string; promotionName: string; effects: ResolvedEffect[] }
export interface EvaluateResult { appliedPromotions: AppliedPromotion[] }

// Codes (C4/C7/D-R4-8)
export interface ReserveCodeInput { codeString: string; cartId: string; customerId: string | null }
export interface CodeReservationResult { ok: true; codeId: string; type: 'static' | 'dynamic' }
export interface CodeValidationResult { valid: boolean; reason?: string }
export interface UseCodeInput { codeId: string; codeString: string; cartId: string; customerId: string | null; type: 'static' | 'dynamic' }
export interface CodeUseResult { ok: true }

// Usage (D-R4-12, D-R4-26)
export interface RegisterUsageInput {
  orderId: string
  orderType: 'order' | 'quote' | 'pos_cart'
  customerId: string | null
  currency: string
  appliedPromotions: AppliedPromotion[]
}
export interface RevertUsageInput { orderId: string }

// Primary integration facade (Amendment §A.2)
export interface PromotionsService {
  evaluate(input: EvaluateInput): Promise<EvaluateResult>
  evaluateForProduct(input: { productId: string; variantId: string | null; buyer: BuyerContext; evaluatedAt: string }): Promise<{ badges: Array<{ promotionId: string; promotionName: string; label: Record<string, string> }> }>
  reserveCode(input: ReserveCodeInput): Promise<CodeReservationResult>
  extendReservation(codeId: string, cartId: string): Promise<void>
  validateCode(input: ReserveCodeInput): Promise<CodeValidationResult>
  useCode(input: UseCodeInput): Promise<CodeUseResult>
  releaseCode(codeId: string, cartId: string): Promise<void>
  registerUsage(input: RegisterUsageInput): Promise<{ ok: true; budgetExceeded: string[] }>
  revertUsage(input: RevertUsageInput): Promise<{ ok: true; revertedCount: number }>
}

// ---------------------------------------------------------------------------
// Normalized Promotion Shape (§Normalized Promotion Shape) — evaluation-engine-internal.
// The active promotions cache stores these as plain objects — never ORM entity graphs.
// Fully eager-loaded, denormalized, and immutable; the only input the evaluation engine
// may receive.
// ---------------------------------------------------------------------------

export interface NormalizedPromotion {
  id: string
  name: string
  order: number
  cumulative: boolean
  tags: string[]
  excludedTags: string[]
  excludeFlags: Record<string, boolean>
  eligibleCurrencies: string[]        // empty array = all currencies
  startsAt: string | null             // ISO date, filtered against context.evaluatedAt at evaluation time
  endsAt: string | null                // same; the cache holds every active=true promotion regardless of its window
  maxBudget: string | null            // null = no cap; decimal string in budgetCurrency
  budgetCurrency: string | null       // ISO 4217; null when maxBudget is null
  totalDiscountGranted: string        // snapshot at cache-build time; used for optimistic budget pre-check only
  rootGroup: NormalizedRuleGroup
}

export interface NormalizedRuleGroup {
  operator: 'and' | 'or'
  rules: NormalizedRule[]        // pre-sorted by sort_order
  benefits: NormalizedBenefit[]  // pre-sorted by sort_order
  children: NormalizedRuleGroup[]
}

export interface NormalizedRule {
  type: string
  config: Record<string, unknown>
}

export interface NormalizedBenefit {
  type: string
  appliesTo: 'order' | 'line' | 'unit'
  config: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// EvaluationContext — not part of the spec's Public TypeScript Contract; this module's
// own internal shape passed from the orchestrator (`lib/evaluation-engine.ts`) down into
// rule evaluation (`lib/rule-evaluators.ts`) and effect resolution (`lib/effect-resolvers.ts`)
// for a single evaluate() call. Carries the caller's input fields the Data Flow algorithm
// actually reads, plus the running `appliedTags` set threaded across promotions in order.
// ---------------------------------------------------------------------------

export interface EvaluationContext {
  items: EnrichedEvaluateItem[]
  currency: string
  evaluatedAt: string
  buyer: BuyerContext
  customerOrderCount: number | null
  cartWeight: string | null
  codes: CodeRef[]
  appliedTags: string[]
  excludeFlags: Record<string, boolean>
  // Optional (Step 2.3b, D-R4-10): the currency's fraction digits for half-up rounding of
  // resolved effect amounts. This pure, DB-free pipeline never resolves it itself — a
  // later step (the `promotionsService` facade, Phase 2 Step 2.6) looks it up from
  // `currencies.Currency.decimalPlaces` and passes it down. `lib/effect-resolvers.ts`
  // defaults to 2 (the ISO 4217 default for the overwhelming majority of currencies) when
  // absent, so this field stays optional and no existing fixture builder needs updating.
  currencyFractionDigits?: number
}

// Enrichment output (SPEC-055 §Data Models "category" row / §API Contracts line ~722):
// built by Step 2.6's batch promotions-side lookup from productId/variantId, BEFORE the
// pure evaluation engine runs. categoryIds is already ancestor-expanded (same convention
// as catalog's scope_keys — packages/core/src/modules/catalog/lib/productScopeKeys.ts —
// every assigned category id plus every one of its ancestorIds), so a rule evaluator only
// ever needs a plain membership check, never its own tree walk. A field with no resolvable
// source for a given product is an empty array/object, never undefined.
export interface EnrichedEvaluateItem extends EvaluateItem {
  categoryIds: string[]
  attributes: Record<string, string>
}

// Internal mirror of the public EvaluateInput (§Public TypeScript Contract) with items
// replaced by their enriched form. The public PromotionsService.evaluate(input:
// EvaluateInput) facade (Step 2.6) builds this from the caller's raw EvaluateInput via
// batch enrichment; evaluatePromotions() below only ever sees the enriched form.
export interface EvaluationInput {
  items: EnrichedEvaluateItem[]
  currency: string
  evaluatedAt: string
  buyer: BuyerContext
  customerOrderCount: number | null
  cartWeight: string | null
  codes: CodeRef[]
  // Optional (Step 2.6): mirrors `EvaluationContext.currencyFractionDigits` one level up —
  // `evaluatePromotions()` copies it straight into every promotion's `EvaluationContext`
  // (see `lib/evaluation-engine.ts`). `promotionsService.evaluate()` is the only caller
  // that ever sets it, resolved from `currencies.Currency.decimalPlaces`; every existing
  // fixture/test omits it and gets the same default-2 behavior as before this field
  // existed (`lib/effect-resolvers.ts`'s `getCurrencyFractionDigits`).
  currencyFractionDigits?: number
}

// ---------------------------------------------------------------------------
// UnitSelection (SPEC-055 §Extension Registry (Server-Side), ~line 1084) — the
// ordered, already-budgeted set of units/lines a capped benefit may discount.
// Produced by `selectUnits(benefit, context)` in `lib/unit-selection.ts` (Step 2.3a);
// consumed by `lib/effect-resolvers.ts` (Step 2.3b) and, in a later phase, by
// `BenefitExtension.resolve()`.
// ---------------------------------------------------------------------------

export type UnitSelection = {
  /** One entry per covered line, in selection order. */
  lines: Array<{
    lineId: string                  // rev — never sku/cartLineId; the caller's own line identity (D-R4-21)
    productId: string
    variantId: string | null
    lineQuantity: number
    /** How many of this line's units the budget covered; ≤ lineQuantity. */
    appliedQuantity: number
    unitPriceNet: string
    unitPriceGross: string
  }>
  /** Total units covered across every line — the spent budget. */
  totalQuantity: number
}
