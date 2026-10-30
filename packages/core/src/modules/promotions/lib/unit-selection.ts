import type { EnrichedEvaluateItem, EvaluationContext, NormalizedBenefit, UnitSelection } from './types'

// Step 2.3a — `selectUnits(benefit, context)` (SPEC-055 §Evaluation Engine Data Flow Pass 3,
// §Data Models "Benefit"/"Quantity caps", §Amendment — 2026-09-07 B.1-B.4). Pure: no DB
// access, no system-clock reads. Orders the benefit's qualifying units/lines by its
// `selector`, then spends the cart-wide `maxQuantity`/`maxLines`/`quantityStep` budget
// across them in the configured order, with a deterministic `lineId`-ascending tie-break.
//
// Does not compute money, does not resolve tiers, does not gate `buy_x_get_y`'s trigger
// condition — those stay `lib/effect-resolvers.ts`'s job (Step 2.3b) and read this
// function's output as an input.

type QuantityCapSelector = 'all' | 'cart_order' | 'cheapest' | 'most_expensive' | 'nth'

type QuantityCapConfig = {
  maxQuantity: number | null
  maxLines: number | null
  quantityStep: number | null
  selector: QuantityCapSelector | null
  nthPosition: number | null
}

function isQuantityCapSelector(value: unknown): value is QuantityCapSelector {
  return (
    value === 'all' ||
    value === 'cart_order' ||
    value === 'cheapest' ||
    value === 'most_expensive' ||
    value === 'nth'
  )
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readNullableNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

function readQuantityCapConfig(config: Record<string, unknown>): QuantityCapConfig {
  return {
    maxQuantity: readNullableNumber(config.maxQuantity),
    maxLines: readNullableNumber(config.maxLines),
    quantityStep: readNullableNumber(config.quantityStep),
    selector: isQuantityCapSelector(config.selector) ? config.selector : null,
    nthPosition: readNullableNumber(config.nthPosition),
  }
}

// Dispatches on `benefit.type` to find the items this specific benefit's cap may ever
// discount (§Benefit application target). `cart_discount`/`free_product`/
// `delivery_discount` are always `applies_to: 'order'` only, so they — along with any
// unrecognized type — fall through to an empty set; the caller's `appliesTo === 'order'`
// check returns an empty UnitSelection regardless, so this never throws.
function selectQualifyingItems(
  benefit: NormalizedBenefit,
  context: EvaluationContext,
): EnrichedEvaluateItem[] {
  switch (benefit.type) {
    case 'product_discount': {
      const productId = readNullableString(benefit.config.productId)
      const limitToCategoryId = readNullableString(benefit.config.limitToCategoryId)
      return context.items.filter((item) => {
        if (productId !== null && item.productId !== productId) return false
        if (limitToCategoryId !== null && !item.categoryIds.includes(limitToCategoryId)) return false
        return true
      })
    }
    case 'buy_x_get_y': {
      // The reward side only — `triggerProductId`/`triggerCategoryId`/`triggerQuantity`
      // gate whether the reward condition is met at all, which is effect-resolvers.ts's
      // job, not this function's.
      const rewardProductId = readNullableString(benefit.config.rewardProductId)
      const rewardVariantId = readNullableString(benefit.config.rewardVariantId)
      return context.items.filter((item) => {
        if (rewardProductId !== null && item.productId !== rewardProductId) return false
        if (rewardVariantId !== null && item.variantId !== rewardVariantId) return false
        return true
      })
    }
    case 'tiered_discount': {
      const limitToCategoryId = readNullableString(benefit.config.limitToCategoryId)
      return context.items.filter((item) => {
        if (limitToCategoryId !== null && !item.categoryIds.includes(limitToCategoryId)) return false
        return true
      })
    }
    default:
      return []
  }
}

type LineCandidate = {
  item: EnrichedEvaluateItem
  sourceIndex: number
}

function buildIndexByItem(allItems: EnrichedEvaluateItem[]): Map<EnrichedEvaluateItem, number> {
  const indexByItem = new Map<EnrichedEvaluateItem, number>()
  allItems.forEach((item, index) => indexByItem.set(item, index))
  return indexByItem
}

// Price- and cart-order comparisons always finish with the `lineId`-ascending tie-break
// the Benefit table states explicitly, so a re-evaluation of an unchanged cart is
// byte-identical (TC-PROM-064).
function compareLineCandidates(a: LineCandidate, b: LineCandidate, selector: QuantityCapSelector | null): number {
  if (selector === 'cheapest' || selector === 'nth') {
    const priceDiff = Number(a.item.unitPriceNet) - Number(b.item.unitPriceNet)
    if (priceDiff !== 0) return priceDiff
  } else if (selector === 'most_expensive') {
    const priceDiff = Number(b.item.unitPriceNet) - Number(a.item.unitPriceNet)
    if (priceDiff !== 0) return priceDiff
  } else {
    // `cart_order`, `all`, and the uncapped/no-selector default all preserve cart order.
    if (a.sourceIndex !== b.sourceIndex) return a.sourceIndex - b.sourceIndex
  }
  if (a.item.lineId !== b.item.lineId) return a.item.lineId < b.item.lineId ? -1 : 1
  return 0
}

function selectUnitsForLineTarget(
  qualifyingItems: EnrichedEvaluateItem[],
  allItems: EnrichedEvaluateItem[],
  cap: QuantityCapConfig,
): UnitSelection {
  const indexByItem = buildIndexByItem(allItems)
  const candidates: LineCandidate[] = qualifyingItems.map((item) => ({
    item,
    sourceIndex: indexByItem.get(item) ?? 0,
  }))
  const ordered = [...candidates].sort((a, b) => compareLineCandidates(a, b, cap.selector))

  if (cap.selector === 'nth') {
    const position = cap.nthPosition ?? 0
    const picked = position >= 1 ? ordered[position - 1] : undefined
    if (!picked) return { lines: [], totalQuantity: 0 }
    const quantity = Number(picked.item.quantity)
    return {
      lines: [
        {
          lineId: picked.item.lineId,
          productId: picked.item.productId,
          variantId: picked.item.variantId,
          lineQuantity: quantity,
          appliedQuantity: quantity,
          unitPriceNet: picked.item.unitPriceNet,
          unitPriceGross: picked.item.unitPriceGross,
        },
      ],
      totalQuantity: quantity,
    }
  }

  // Under `applies_to: 'line'`, a cap spends whole lines: cover a qualifying line only
  // when covering it in full would not exceed the remaining `maxQuantity`/`maxLines`
  // budget; otherwise skip it and keep checking the REMAINING lines (never stop at the
  // first line that does not fit — the Benefit table's own worked example requires this).
  let remainingQuantityBudget = cap.maxQuantity ?? Infinity
  let remainingLineBudget = cap.maxLines ?? Infinity
  const lines: UnitSelection['lines'] = []

  for (const candidate of ordered) {
    const quantity = Number(candidate.item.quantity)
    if (quantity <= remainingQuantityBudget && remainingLineBudget >= 1) {
      lines.push({
        lineId: candidate.item.lineId,
        productId: candidate.item.productId,
        variantId: candidate.item.variantId,
        lineQuantity: quantity,
        appliedQuantity: quantity,
        unitPriceNet: candidate.item.unitPriceNet,
        unitPriceGross: candidate.item.unitPriceGross,
      })
      remainingQuantityBudget -= quantity
      remainingLineBudget -= 1
    }
  }

  const totalQuantity = lines.reduce((sum, line) => sum + line.appliedQuantity, 0)
  return { lines, totalQuantity }
}

type UnitCandidate = {
  item: EnrichedEvaluateItem
  sourceIndex: number
  unitIndex: number
}

function buildUnitCandidates(qualifyingItems: EnrichedEvaluateItem[], allItems: EnrichedEvaluateItem[]): UnitCandidate[] {
  const indexByItem = buildIndexByItem(allItems)
  const candidates: UnitCandidate[] = []
  for (const item of qualifyingItems) {
    const quantity = Number(item.quantity)
    const sourceIndex = indexByItem.get(item) ?? 0
    for (let unitIndex = 0; unitIndex < quantity; unitIndex += 1) {
      candidates.push({ item, sourceIndex, unitIndex })
    }
  }
  return candidates
}

function compareUnitCandidates(a: UnitCandidate, b: UnitCandidate, selector: QuantityCapSelector | null): number {
  if (selector === 'cheapest' || selector === 'nth') {
    const priceDiff = Number(a.item.unitPriceNet) - Number(b.item.unitPriceNet)
    if (priceDiff !== 0) return priceDiff
  } else if (selector === 'most_expensive') {
    const priceDiff = Number(b.item.unitPriceNet) - Number(a.item.unitPriceNet)
    if (priceDiff !== 0) return priceDiff
  } else {
    if (a.sourceIndex !== b.sourceIndex) return a.sourceIndex - b.sourceIndex
  }
  if (a.item.lineId !== b.item.lineId) return a.item.lineId < b.item.lineId ? -1 : 1
  return a.unitIndex - b.unitIndex
}

type UnitLineGroup = {
  lineId: string
  productId: string
  variantId: string | null
  lineQuantity: number
  unitPriceNet: string
  unitPriceGross: string
  unitCount: number
}

// Every unit of one qualifying line shares that line's price, so any of the comparators
// above always keeps one line's units contiguous in the ordered sequence (same price ⇒
// equal primary key, and the `lineId` tie-break keeps a tied line's own units together
// too). Grouping consecutive same-`lineId` candidates is therefore safe and lossless.
function groupOrderedUnitCandidates(ordered: UnitCandidate[]): UnitLineGroup[] {
  const groups: UnitLineGroup[] = []
  for (const candidate of ordered) {
    const last = groups[groups.length - 1]
    if (last && last.lineId === candidate.item.lineId) {
      last.unitCount += 1
      continue
    }
    groups.push({
      lineId: candidate.item.lineId,
      productId: candidate.item.productId,
      variantId: candidate.item.variantId,
      lineQuantity: Number(candidate.item.quantity),
      unitPriceNet: candidate.item.unitPriceNet,
      unitPriceGross: candidate.item.unitPriceGross,
      unitCount: 1,
    })
  }
  return groups
}

function selectUnitsForUnitTarget(
  qualifyingItems: EnrichedEvaluateItem[],
  allItems: EnrichedEvaluateItem[],
  cap: QuantityCapConfig,
): UnitSelection {
  const candidates = buildUnitCandidates(qualifyingItems, allItems)
  const ordered = [...candidates].sort((a, b) => compareUnitCandidates(a, b, cap.selector))

  if (cap.selector === 'nth') {
    const position = cap.nthPosition ?? 0
    const picked = position >= 1 ? ordered[position - 1] : undefined
    if (!picked) return { lines: [], totalQuantity: 0 }
    return {
      lines: [
        {
          lineId: picked.item.lineId,
          productId: picked.item.productId,
          variantId: picked.item.variantId,
          lineQuantity: Number(picked.item.quantity),
          appliedQuantity: 1,
          unitPriceNet: picked.item.unitPriceNet,
          unitPriceGross: picked.item.unitPriceGross,
        },
      ],
      totalQuantity: 1,
    }
  }

  // Under `applies_to: 'unit'`, units are consumed in whole blocks of `quantityStep`
  // (default 1). `maxLines` counts distinct TOUCHED lines, not fully-covered lines — once
  // the touched-line budget is spent, a brand-new line is skipped even if `maxQuantity`
  // budget remains; an already-touched line keeps receiving blocks until its own run (or
  // the quantity budget) runs out.
  const step = cap.quantityStep ?? 1
  let remainingQuantityBudget = cap.maxQuantity ?? Infinity
  const maxLinesBudget = cap.maxLines ?? Infinity
  let touchedLinesCount = 0
  const lines: UnitSelection['lines'] = []

  for (const group of groupOrderedUnitCandidates(ordered)) {
    if (touchedLinesCount >= maxLinesBudget) continue

    let appliedInLine = 0
    let consumed = 0
    while (consumed + step <= group.unitCount && step <= remainingQuantityBudget) {
      appliedInLine += step
      remainingQuantityBudget -= step
      consumed += step
    }

    if (appliedInLine > 0) {
      lines.push({
        lineId: group.lineId,
        productId: group.productId,
        variantId: group.variantId,
        lineQuantity: group.lineQuantity,
        appliedQuantity: appliedInLine,
        unitPriceNet: group.unitPriceNet,
        unitPriceGross: group.unitPriceGross,
      })
      touchedLinesCount += 1
    }
  }

  const totalQuantity = lines.reduce((sum, line) => sum + line.appliedQuantity, 0)
  return { lines, totalQuantity }
}

export function selectUnits(benefit: NormalizedBenefit, context: EvaluationContext): UnitSelection {
  if (benefit.appliesTo === 'order') {
    return { lines: [], totalQuantity: 0 }
  }

  const qualifyingItems = selectQualifyingItems(benefit, context)
  const cap = readQuantityCapConfig(benefit.config)

  if (benefit.appliesTo === 'line') {
    return selectUnitsForLineTarget(qualifyingItems, context.items, cap)
  }

  return selectUnitsForUnitTarget(qualifyingItems, context.items, cap)
}
