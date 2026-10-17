import { selectUnits } from './unit-selection'
import type {
  AddFreeItemEffect,
  CartDiscountEffect,
  EnrichedEvaluateItem,
  EvaluationContext,
  LineDiscountEffect,
  NormalizedBenefit,
  ResolvedEffect,
  UnitSelection,
} from './types'

// Step 2.3b — `resolveEffects(benefits, context, promotionId)` (SPEC-055 §Evaluation
// Engine Data Flow Pass 3, §Data Models "Benefit"/"Quantity caps", §API Contracts
// "Resolved Effect Types"/"Invariants", §Amendment — 2026-09-07 B.1-B.6, D-R4-7, D-R4-10).
// Pure: no DB access, no system-clock reads, no catalog lookups. Dispatches on
// `benefit.type` to one handler per Release 4 shipped benefit type; an unrecognized type
// (including the hidden `delivery_discount`, D-R4-14) produces no effect rather than
// throwing, so one malformed/unsupported benefit never aborts the rest of the promotion.

type DiscountType = 'percentage' | 'fixed'

function isDiscountType(value: unknown): value is DiscountType {
  return value === 'percentage' || value === 'fixed'
}

function readDiscountType(value: unknown): DiscountType {
  return isDiscountType(value) ? value : 'percentage'
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback
}

function readNullableNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

function readNullableDecimalNumber(value: unknown): number | null {
  return typeof value === 'string' && value.length > 0 ? Number(value) : null
}

function readLabels(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) return {}
  const labels: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string') labels[key] = entry
  }
  return labels
}

type TierElement = { threshold: string; discountType: DiscountType; value: string }

function readTiers(value: unknown): TierElement[] {
  if (!Array.isArray(value)) return []
  const tiers: TierElement[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    if (typeof record.threshold !== 'string' || typeof record.value !== 'string') continue
    tiers.push({ threshold: record.threshold, discountType: readDiscountType(record.discountType), value: record.value })
  }
  return tiers
}

// `currencyFractionDigits` is optional on `EvaluationContext` (see `lib/types.ts`) because
// the pure evaluation engine never resolves a currency's fraction digits itself — a later
// step (the `promotionsService` facade) looks it up from `currencies.Currency.decimalPlaces`
// and passes it down. Absent, this file defaults to 2 (the ISO 4217 default for the
// overwhelming majority of currencies).
function getCurrencyFractionDigits(context: EvaluationContext): number {
  return context.currencyFractionDigits ?? 2
}

// D-R4-10: "rounded once, half-up, at the currency's fraction digits in integer minor
// units". `Math.round` rounds half-away-from-zero only for positive numbers in JS — every
// discount amount here is negative, so a literal `Math.round(amount * factor) / factor`
// would round `-2.5` to `-2` (towards +Infinity), not the `-3` true half-up demands. Round
// the absolute value half-up, then reapply the sign, and format from the resulting integer
// minor-units value directly (never re-divide a float and `toFixed()` it) so no float
// reconversion error can creep back in after the rounding step already removed it.
function roundHalfUpToMinorUnits(amount: number, fractionDigits: number): string {
  const factor = 10 ** fractionDigits
  const absMinorUnits = Math.floor(Math.abs(amount) * factor + 0.5)
  const isNegative = amount < 0 && absMinorUnits !== 0
  const digits = absMinorUnits.toString().padStart(fractionDigits + 1, '0')
  const wholePart = fractionDigits === 0 ? digits : digits.slice(0, -fractionDigits)
  const fractionPart = fractionDigits === 0 ? '' : digits.slice(-fractionDigits)
  const formatted = fractionDigits === 0 ? wholePart : `${wholePart}.${fractionPart}`
  return isNegative ? `-${formatted}` : formatted
}

// Raw (unrounded) signed discount amount for one side (net or gross). Percentage scales
// against `baseAmount` directly. A `fixed` amount is NOT scaled by `baseAmount` — it is
// the full configured figure for `cart_discount` (an order-scoped amount with no quantity
// dimension, `quantity: 1`, confirmed by TC-PROM-014's cart_discount worked example, which
// needs no quantity multiplication at all) but IS scaled by `quantity` for a line-targeted
// benefit (`product_discount`/`buy_x_get_y`/`tiered_discount` under `line`/`unit`), where
// `value` reads as a per-unit fixed amount off each covered unit — a judgment call neither
// config table spells out explicitly, resolved the same way for both for consistency.
function computeDiscountAmount(discountType: DiscountType, value: string, baseAmount: number, quantity: number): number {
  if (discountType === 'percentage') return -(baseAmount * Number(value) / 100)
  return -(Number(value) * quantity)
}

type RawAmountPair = { rawNet: number; rawGross: number }

// Net and gross are computed independently from the item's own `unitPriceNet`/
// `unitPriceGross` — never derived from one another — per the Invariants list ("cart
// always consumes amountNet/amountGross, never re-derives one from the other").
function computeRawAmountPair(discountType: DiscountType, value: string, baseNet: number, baseGross: number, quantity: number): RawAmountPair {
  return {
    rawNet: computeDiscountAmount(discountType, value, baseNet, quantity),
    rawGross: computeDiscountAmount(discountType, value, baseGross, quantity),
  }
}

// `max_discount` caps the total monetary discount produced by one benefit invocation
// (§Benefit "Quantity caps", §Invariants). For a single-effect invocation (`cart_discount`,
// `tiered_discount` under `order`) this is a direct `min(|rawAmount|, maxDiscount)`. For a
// multi-line invocation (`product_discount`/`buy_x_get_y`/`tiered_discount` under
// `line`/`unit`, where `selectUnits` may return several covered lines) every line's raw
// amount is scaled down by the SAME ratio so no single line absorbs the whole cut while
// the others stay at their uncapped raw value — `appliedQuantity` is never touched here
// (TC-PROM-065(b): the cap reduces the amount granted, not the units covered).
function applyMaxDiscountCap(entries: RawAmountPair[], maxDiscount: number | null): RawAmountPair[] {
  if (maxDiscount === null) return entries
  const totalAbsNet = entries.reduce((sum, entry) => sum + Math.abs(entry.rawNet), 0)
  if (totalAbsNet === 0 || totalAbsNet <= maxDiscount) return entries
  const ratio = maxDiscount / totalAbsNet
  return entries.map((entry) => ({ rawNet: entry.rawNet * ratio, rawGross: entry.rawGross * ratio }))
}

// Integer-minor-units sum, same money-math discipline as this module's own
// `roundHalfUpToMinorUnits`/`lib/promotion-usage-service.ts`'s `toMinorUnits`: each item's
// `quantity * unitPrice` is rounded to one integer minor-units value, then every item is
// SUMMED as an integer. A cart with many lines previously summed raw float products first
// and rounded once at the very end — the accumulated float drift across terms could land a
// cart total a cent off its true value, which `resolveTieredDiscount`'s `<=` threshold
// comparison (below) could then miss at an exact boundary (review finding).
function sumQuantityPriceMinorUnits(items: EnrichedEvaluateItem[], field: 'unitPriceNet' | 'unitPriceGross', fractionDigits: number): number {
  const factor = 10 ** fractionDigits
  return items.reduce((sum, item) => sum + Math.round(Number(item.quantity) * Number(item[field]) * factor), 0)
}

function sumQuantityPrice(items: EnrichedEvaluateItem[], field: 'unitPriceNet' | 'unitPriceGross', fractionDigits: number): number {
  return sumQuantityPriceMinorUnits(items, field, fractionDigits) / 10 ** fractionDigits
}

// Shared by `product_discount`, the partial-discount branch of `buy_x_get_y`, and
// `tiered_discount` under `line`/`unit` — one `LINE_DISCOUNT` effect per covered line,
// `basis: 'net'` always (no benefit config anywhere in the model exposes a basis choice —
// the same judgment call `lib/rule-evaluators.ts` already made for `row_total`, continued
// here for consistency).
function buildLineDiscountEffects(
  lines: UnitSelection['lines'],
  discountType: DiscountType,
  value: string,
  maxDiscount: number | null,
  appliesTo: 'order' | 'line' | 'unit',
  labels: Record<string, string>,
  currency: string,
  fractionDigits: number,
): LineDiscountEffect[] {
  if (lines.length === 0) return []

  const rawEntries = lines.map((line) => {
    const baseNet = Number(line.unitPriceNet) * line.appliedQuantity
    const baseGross = Number(line.unitPriceGross) * line.appliedQuantity
    return computeRawAmountPair(discountType, value, baseNet, baseGross, line.appliedQuantity)
  })
  const cappedEntries = applyMaxDiscountCap(rawEntries, maxDiscount)

  return lines.map((line, index) => {
    const capped = cappedEntries[index]
    return {
      type: 'LINE_DISCOUNT',
      appliesTo,
      currency,
      label: labels,
      targetLineId: line.lineId,
      targetProductId: line.productId,
      targetVariantId: line.variantId,
      lineQuantity: line.lineQuantity,
      appliedQuantity: line.appliedQuantity,
      amountNet: roundHalfUpToMinorUnits(capped.rawNet, fractionDigits),
      amountGross: roundHalfUpToMinorUnits(capped.rawGross, fractionDigits),
      basis: 'net',
    }
  })
}

// `cart_discount` is always `applies_to: 'order'` — base amount is the whole cart subtotal
// (this type has no product/category filter). A raw amount that rounds to exactly 0 (e.g.
// an empty cart) still produces an effect — only a zero-quantity LINE_DISCOUNT line is
// omitted (§Invariants "appliedQuantity ≥ 1"); CART_DISCOUNT has no quantity dimension.
function resolveCartDiscount(benefit: NormalizedBenefit, context: EvaluationContext): ResolvedEffect[] {
  const config = benefit.config
  const discountType = readDiscountType(config.discountType)
  const value = readString(config.value, '0')
  const maxDiscount = readNullableDecimalNumber(config.maxDiscount)
  const labels = readLabels(config.labels)
  const fractionDigits = getCurrencyFractionDigits(context)

  const baseNet = sumQuantityPrice(context.items, 'unitPriceNet', fractionDigits)
  const baseGross = sumQuantityPrice(context.items, 'unitPriceGross', fractionDigits)
  const raw = computeRawAmountPair(discountType, value, baseNet, baseGross, 1)
  const [capped] = applyMaxDiscountCap([raw], maxDiscount)

  const effect: CartDiscountEffect = {
    type: 'CART_DISCOUNT',
    appliesTo: 'order',
    currency: context.currency,
    label: labels,
    amountNet: roundHalfUpToMinorUnits(capped.rawNet, fractionDigits),
    amountGross: roundHalfUpToMinorUnits(capped.rawGross, fractionDigits),
    basis: 'net',
  }
  return [effect]
}

function resolveProductDiscount(benefit: NormalizedBenefit, context: EvaluationContext): ResolvedEffect[] {
  const config = benefit.config
  const discountType = readDiscountType(config.discountType)
  const value = readString(config.value, '0')
  const maxDiscount = readNullableDecimalNumber(config.maxDiscount)
  const labels = readLabels(config.labels)
  const fractionDigits = getCurrencyFractionDigits(context)

  const selection = selectUnits(benefit, context)
  return buildLineDiscountEffects(selection.lines, discountType, value, maxDiscount, benefit.appliesTo, labels, context.currency, fractionDigits)
}

// `free_product` is always `applies_to: 'order'` with no monetary amount (§Resolved Effect
// Types). `config.categoryId` is the alternative to `config.productId` — "any product in
// this category" — and resolving that to one concrete product needs a catalog lookup,
// explicitly out of scope for this pure function (`cart` performs that check per the
// Invariants list). Only the concrete `productId` branch is handled; the category-only
// case emits no effect rather than guessing a product.
function resolveFreeProduct(benefit: NormalizedBenefit, context: EvaluationContext, promotionId: string): ResolvedEffect[] {
  const config = benefit.config
  const productId = readNullableString(config.productId)
  if (productId === null) return []

  const effect: AddFreeItemEffect = {
    type: 'ADD_FREE_ITEM',
    appliesTo: 'order',
    currency: context.currency,
    label: readLabels(config.labels),
    productId,
    variantId: null,
    quantity: readNumber(config.quantity, 0),
    reason: 'FREE_PRODUCT',
    promotionId,
  }
  return [effect]
}

function computeTriggerQuantityAvailable(config: Record<string, unknown>, context: EvaluationContext): number {
  const triggerProductId = readNullableString(config.triggerProductId)
  const triggerCategoryId = readNullableString(config.triggerCategoryId)
  let total = 0
  for (const item of context.items) {
    if (triggerProductId !== null && item.productId !== triggerProductId) continue
    if (triggerCategoryId !== null && !item.categoryIds.includes(triggerCategoryId)) continue
    total += Number(item.quantity)
  }
  return total
}

// `buy_x_get_y` is the one benefit type that can emit either `ADD_FREE_ITEM` or
// `LINE_DISCOUNT`. The trigger condition is checked against the UNFILTERED cart first;
// each firing of the trigger (`floor(triggerQuantityAvailable / triggerQuantity)`, capped
// by `maxApplications`) grants `rewardQuantity` reward units, for a total entitlement of
// `applications * rewardQuantity`. A fully-free (100% off) reward has no existing line to
// attribute a discount to, so it is always `ADD_FREE_ITEM` regardless of `applies_to`
// (§Benefit application target: "...because there is no existing line to attribute it
// to"). A partial discount instead discounts the reward product's existing cart line(s),
// via `selectUnits`, further trimmed to the trigger-derived entitlement — a second,
// independent cap on top of whatever `selectUnits` already applied.
function resolveBuyXGetY(benefit: NormalizedBenefit, context: EvaluationContext, promotionId: string): ResolvedEffect[] {
  const config = benefit.config
  const triggerQuantity = readNumber(config.triggerQuantity, 0)
  if (triggerQuantity <= 0) return []

  const rewardQuantity = readNumber(config.rewardQuantity, 0)
  const maxApplications = readNullableNumber(config.maxApplications)
  const triggerQuantityAvailable = computeTriggerQuantityAvailable(config, context)

  let applications = Math.floor(triggerQuantityAvailable / triggerQuantity)
  if (maxApplications !== null) applications = Math.min(applications, maxApplications)
  if (applications <= 0) return []

  const totalRewardQuantity = applications * rewardQuantity
  const discountType = readDiscountType(config.discountType)
  const value = readString(config.value, '0')
  const labels = readLabels(config.labels)

  if (discountType === 'percentage' && Number(value) === 100) {
    const effect: AddFreeItemEffect = {
      type: 'ADD_FREE_ITEM',
      appliesTo: 'order',
      currency: context.currency,
      label: labels,
      productId: readString(config.rewardProductId, ''),
      variantId: readNullableString(config.rewardVariantId),
      quantity: totalRewardQuantity,
      reason: 'BUY_X_GET_Y',
      promotionId,
    }
    return [effect]
  }

  const selection = selectUnits(benefit, context)
  if (selection.lines.length === 0) return []

  let remainingEntitlement = totalRewardQuantity
  const trimmedLines: UnitSelection['lines'] = []
  for (const line of selection.lines) {
    if (remainingEntitlement <= 0) break
    const appliedQuantity = Math.min(line.appliedQuantity, remainingEntitlement)
    if (appliedQuantity > 0) {
      trimmedLines.push({ ...line, appliedQuantity })
      remainingEntitlement -= appliedQuantity
    }
  }
  // A <100%-off reward discounts an existing line; after trimming to the trigger-derived
  // entitlement there may be nothing left to attribute it to. Not resolved further here —
  // just emit no effect rather than inventing a line.
  if (trimmedLines.length === 0) return []

  const maxDiscount = readNullableDecimalNumber(config.maxDiscount)
  const fractionDigits = getCurrencyFractionDigits(context)
  return buildLineDiscountEffects(trimmedLines, discountType, value, maxDiscount, benefit.appliesTo, labels, context.currency, fractionDigits)
}

// `tiered_discount` picks the highest tier whose `threshold` is met against the qualifying
// base amount (every item, or category-narrowed by `limitToCategoryId`), then applies that
// tier's own `discountType`/`value` exactly like the other types. Under `applies_to:
// 'order'` the base amount IS the effect's base (a category-limited order-scope tiered
// discount still emits one CART_DISCOUNT, computed against the narrowed base — the effect
// shape has no target-line/category field to narrow further). Under `line`/`unit`,
// `selectUnits` supplies the covered lines (it already applies the same category filter).
function resolveTieredDiscount(benefit: NormalizedBenefit, context: EvaluationContext): ResolvedEffect[] {
  const config = benefit.config
  const limitToCategoryId = readNullableString(config.limitToCategoryId)
  const tiers = readTiers(config.tiers)
  const maxDiscount = readNullableDecimalNumber(config.maxDiscount)
  const labels = readLabels(config.labels)
  const fractionDigits = getCurrencyFractionDigits(context)

  const qualifyingItems =
    limitToCategoryId === null ? context.items : context.items.filter((item) => item.categoryIds.includes(limitToCategoryId))
  const baseForThresholdMinorUnits = sumQuantityPriceMinorUnits(qualifyingItems, 'unitPriceNet', fractionDigits)
  const baseForThreshold = baseForThresholdMinorUnits / 10 ** fractionDigits

  // Compared in integer minor units, not as floats: `tier.threshold` is itself a decimal
  // string over the same `numeric(16,2)`-style column family, so converting both sides to
  // the same integer unit before comparing removes any float boundary-miss risk at an exact
  // threshold (review finding).
  let winningTier: TierElement | null = null
  for (const tier of tiers) {
    const thresholdMinorUnits = Math.round(Number(tier.threshold) * 10 ** fractionDigits)
    if (thresholdMinorUnits <= baseForThresholdMinorUnits) winningTier = tier
  }
  if (winningTier === null) return []

  if (benefit.appliesTo === 'order') {
    const baseGross = sumQuantityPrice(qualifyingItems, 'unitPriceGross', fractionDigits)
    const raw = computeRawAmountPair(winningTier.discountType, winningTier.value, baseForThreshold, baseGross, 1)
    const [capped] = applyMaxDiscountCap([raw], maxDiscount)
    const effect: CartDiscountEffect = {
      type: 'CART_DISCOUNT',
      appliesTo: 'order',
      currency: context.currency,
      label: labels,
      amountNet: roundHalfUpToMinorUnits(capped.rawNet, fractionDigits),
      amountGross: roundHalfUpToMinorUnits(capped.rawGross, fractionDigits),
      basis: 'net',
    }
    return [effect]
  }

  const selection = selectUnits(benefit, context)
  return buildLineDiscountEffects(
    selection.lines,
    winningTier.discountType,
    winningTier.value,
    maxDiscount,
    benefit.appliesTo,
    labels,
    context.currency,
    fractionDigits,
  )
}

export function resolveEffects(benefits: NormalizedBenefit[], context: EvaluationContext, promotionId: string): ResolvedEffect[] {
  const effects: ResolvedEffect[] = []

  for (const benefit of benefits) {
    switch (benefit.type) {
      case 'cart_discount':
        effects.push(...resolveCartDiscount(benefit, context))
        break
      case 'product_discount':
        effects.push(...resolveProductDiscount(benefit, context))
        break
      case 'free_product':
        effects.push(...resolveFreeProduct(benefit, context, promotionId))
        break
      case 'buy_x_get_y':
        effects.push(...resolveBuyXGetY(benefit, context, promotionId))
        break
      case 'tiered_discount':
        effects.push(...resolveTieredDiscount(benefit, context))
        break
      case 'delivery_discount':
        // D-R4-14: hidden from the admin tree builder; no rule tree in Release 4 can ever
        // select it into a live promotion. Defensive no-op rather than throwing.
        break
      default:
        // An unrecognized benefit type produces no effect and never aborts the rest of
        // the promotion's other benefits.
        break
    }
  }

  return effects
}
