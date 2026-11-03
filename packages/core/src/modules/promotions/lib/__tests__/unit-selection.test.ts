// Step 2.3a — `selectUnits` (SPEC-055 §Evaluation Engine Data Flow Pass 3, §Data Models
// "Benefit"/"Quantity caps", §Amendment — 2026-09-07 B.1-B.4). All fixtures are pure
// in-memory objects — no DB, no helpers needed.

import { selectUnits } from '../unit-selection'
import type { EnrichedEvaluateItem, EvaluationContext, NormalizedBenefit } from '../types'

function item(overrides: Partial<EnrichedEvaluateItem> = {}): EnrichedEvaluateItem {
  return {
    lineId: 'line-1',
    productId: 'product-1',
    variantId: null,
    quantity: '1',
    unitPriceNet: '10.00',
    unitPriceGross: '12.00',
    priceIsPromotional: false,
    categoryIds: [],
    attributes: {},
    ...overrides,
  }
}

function context(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    items: [],
    currency: 'USD',
    evaluatedAt: '2026-06-15T00:00:00.000Z',
    buyer: { customerId: null, customerIds: [], customerGroupIds: [] },
    customerOrderCount: null,
    cartWeight: null,
    codes: [],
    appliedTags: [],
    excludeFlags: {},
    ...overrides,
  }
}

function benefit(
  type: string,
  appliesTo: 'order' | 'line' | 'unit',
  config: Record<string, unknown>,
): NormalizedBenefit {
  return { type, appliesTo, config }
}

describe('applies_to: order always returns an empty selection', () => {
  it('cart_discount ignores cart contents', () => {
    const b = benefit('cart_discount', 'order', {})
    const ctx = context({ items: [item({ lineId: 'line-1', quantity: '3' })] })
    expect(selectUnits(b, ctx)).toEqual({ lines: [], totalQuantity: 0 })
  })

  it('free_product ignores cart contents', () => {
    const b = benefit('free_product', 'order', { productId: null, categoryId: null, quantity: 1 })
    const ctx = context({ items: [item({ lineId: 'line-1', quantity: '3' })] })
    expect(selectUnits(b, ctx)).toEqual({ lines: [], totalQuantity: 0 })
  })
})

describe('product_discount under applies_to: line', () => {
  it('selector cart_order with no cap selects every qualifying line in array order', () => {
    const b = benefit('product_discount', 'line', {
      productId: null,
      limitToCategoryId: null,
      selector: 'cart_order',
      maxQuantity: null,
      maxLines: null,
      quantityStep: null,
      nthPosition: null,
    })
    const items = [
      item({ lineId: 'line-a', productId: 'p1', quantity: '2', unitPriceNet: '10.00' }),
      item({ lineId: 'line-b', productId: 'p1', quantity: '3', unitPriceNet: '5.00' }),
    ]
    const result = selectUnits(b, context({ items }))
    expect(result.lines.map((l) => l.lineId)).toEqual(['line-a', 'line-b'])
    expect(result.lines[0].appliedQuantity).toBe(2)
    expect(result.lines[1].appliedQuantity).toBe(3)
    expect(result.totalQuantity).toBe(5)
  })

  it('max_quantity 5 under applies_to: unit discounts 4 on the first eligible line, 1 on the second, none on the third', () => {
    const b = benefit('product_discount', 'unit', {
      productId: null,
      limitToCategoryId: null,
      selector: 'cart_order',
      maxQuantity: 5,
      maxLines: null,
      quantityStep: null,
      nthPosition: null,
    })
    const items = [
      item({ lineId: 'line-a', productId: 'p1', quantity: '4', unitPriceNet: '10.00' }),
      item({ lineId: 'line-b', productId: 'p1', quantity: '4', unitPriceNet: '10.00' }),
      item({ lineId: 'line-c', productId: 'p1', quantity: '4', unitPriceNet: '10.00' }),
    ]
    const result = selectUnits(b, context({ items }))
    expect(result.lines).toEqual([
      expect.objectContaining({ lineId: 'line-a', lineQuantity: 4, appliedQuantity: 4 }),
      expect.objectContaining({ lineId: 'line-b', lineQuantity: 4, appliedQuantity: 1 }),
    ])
    expect(result.totalQuantity).toBe(5)
  })

  it('the same max_quantity 5 under applies_to: line covers only the first whole line and leaves the rest uncovered', () => {
    const b = benefit('product_discount', 'line', {
      productId: null,
      limitToCategoryId: null,
      selector: 'cart_order',
      maxQuantity: 5,
      maxLines: null,
      quantityStep: null,
      nthPosition: null,
    })
    const items = [
      item({ lineId: 'line-a', productId: 'p1', quantity: '4', unitPriceNet: '10.00' }),
      item({ lineId: 'line-b', productId: 'p1', quantity: '4', unitPriceNet: '10.00' }),
      item({ lineId: 'line-c', productId: 'p1', quantity: '4', unitPriceNet: '10.00' }),
    ]
    const result = selectUnits(b, context({ items }))
    expect(result.lines).toEqual([
      expect.objectContaining({ lineId: 'line-a', lineQuantity: 4, appliedQuantity: 4 }),
    ])
    expect(result.totalQuantity).toBe(4)
  })
})

describe('cheapest / most_expensive ordering', () => {
  const items = [
    item({ lineId: 'line-cheap', productId: 'p1', quantity: '1', unitPriceNet: '5.00' }),
    item({ lineId: 'line-mid', productId: 'p1', quantity: '1', unitPriceNet: '10.00' }),
    item({ lineId: 'line-expensive', productId: 'p1', quantity: '1', unitPriceNet: '20.00' }),
  ]

  it('cheapest spends a max_lines: 1 budget on the lowest-priced line', () => {
    const b = benefit('product_discount', 'line', {
      productId: null,
      limitToCategoryId: null,
      selector: 'cheapest',
      maxQuantity: null,
      maxLines: 1,
      quantityStep: null,
      nthPosition: null,
    })
    const result = selectUnits(b, context({ items }))
    expect(result.lines.map((l) => l.lineId)).toEqual(['line-cheap'])
  })

  it('most_expensive spends the same max_lines: 1 budget on the highest-priced line', () => {
    const b = benefit('product_discount', 'line', {
      productId: null,
      limitToCategoryId: null,
      selector: 'most_expensive',
      maxQuantity: null,
      maxLines: 1,
      quantityStep: null,
      nthPosition: null,
    })
    const result = selectUnits(b, context({ items }))
    expect(result.lines.map((l) => l.lineId)).toEqual(['line-expensive'])
  })
})

describe('quantityStep under applies_to: unit', () => {
  it('a max_quantity that is not a multiple of quantityStep leaves a partial remainder undiscounted', () => {
    const b = benefit('product_discount', 'unit', {
      productId: null,
      limitToCategoryId: null,
      selector: 'cart_order',
      maxQuantity: 5,
      maxLines: null,
      quantityStep: 2,
      nthPosition: null,
    })
    const items = [item({ lineId: 'line-a', productId: 'p1', quantity: '6', unitPriceNet: '10.00' })]
    const result = selectUnits(b, context({ items }))
    expect(result.totalQuantity).toBe(4)
    expect(result.lines[0].appliedQuantity).toBe(4)
  })
})

describe('max_lines independently truncating a line-mode selection', () => {
  it('stops at max_lines: 2 even though max_quantity alone would allow every line', () => {
    const b = benefit('product_discount', 'line', {
      productId: null,
      limitToCategoryId: null,
      selector: 'cart_order',
      maxQuantity: 100,
      maxLines: 2,
      quantityStep: null,
      nthPosition: null,
    })
    const items = [
      item({ lineId: 'line-a', productId: 'p1', quantity: '2', unitPriceNet: '10.00' }),
      item({ lineId: 'line-b', productId: 'p1', quantity: '2', unitPriceNet: '10.00' }),
      item({ lineId: 'line-c', productId: 'p1', quantity: '2', unitPriceNet: '10.00' }),
      item({ lineId: 'line-d', productId: 'p1', quantity: '2', unitPriceNet: '10.00' }),
    ]
    const result = selectUnits(b, context({ items }))
    expect(result.lines.map((l) => l.lineId)).toEqual(['line-a', 'line-b'])
    expect(result.totalQuantity).toBe(4)
  })
})

describe('nth selector', () => {
  it('selects exactly the candidate at the configured ascending-price position', () => {
    const b = benefit('product_discount', 'line', {
      productId: null,
      limitToCategoryId: null,
      selector: 'nth',
      maxQuantity: null,
      maxLines: null,
      quantityStep: null,
      nthPosition: 2,
    })
    const items = [
      item({ lineId: 'line-a', productId: 'p1', quantity: '1', unitPriceNet: '20.00' }),
      item({ lineId: 'line-b', productId: 'p1', quantity: '1', unitPriceNet: '5.00' }),
      item({ lineId: 'line-c', productId: 'p1', quantity: '1', unitPriceNet: '10.00' }),
    ]
    // Ascending price order: line-b (5), line-c (10), line-a (20) — position 2 is line-c.
    const result = selectUnits(b, context({ items }))
    expect(result.lines.map((l) => l.lineId)).toEqual(['line-c'])
    expect(result.totalQuantity).toBe(1)
  })

  it('an out-of-range nthPosition returns an empty selection', () => {
    const b = benefit('product_discount', 'line', {
      productId: null,
      limitToCategoryId: null,
      selector: 'nth',
      maxQuantity: null,
      maxLines: null,
      quantityStep: null,
      nthPosition: 10,
    })
    const items = [item({ lineId: 'line-a', productId: 'p1', quantity: '1', unitPriceNet: '20.00' })]
    expect(selectUnits(b, context({ items }))).toEqual({ lines: [], totalQuantity: 0 })
  })
})

describe('qualifying-item filters narrow the candidate set', () => {
  it('product_discount productId excludes items for other products even when they are first/cheapest', () => {
    const b = benefit('product_discount', 'line', {
      productId: 'p1',
      limitToCategoryId: null,
      selector: 'cheapest',
      maxQuantity: null,
      maxLines: null,
      quantityStep: null,
      nthPosition: null,
    })
    const items = [
      item({ lineId: 'line-other-product', productId: 'p2', quantity: '1', unitPriceNet: '0.50' }),
      item({ lineId: 'line-matching', productId: 'p1', quantity: '1', unitPriceNet: '50.00' }),
    ]
    const result = selectUnits(b, context({ items }))
    expect(result.lines.map((l) => l.lineId)).toEqual(['line-matching'])
  })

  it('product_discount limitToCategoryId excludes items outside the category even when cheapest', () => {
    const b = benefit('product_discount', 'line', {
      productId: null,
      limitToCategoryId: 'cat-1',
      selector: 'cheapest',
      maxQuantity: null,
      maxLines: null,
      quantityStep: null,
      nthPosition: null,
    })
    const items = [
      item({ lineId: 'line-cheap-wrong-cat', productId: 'p1', quantity: '1', unitPriceNet: '1.00', categoryIds: ['cat-2'] }),
      item({ lineId: 'line-in-cat', productId: 'p1', quantity: '1', unitPriceNet: '50.00', categoryIds: ['cat-1'] }),
    ]
    const result = selectUnits(b, context({ items }))
    expect(result.lines.map((l) => l.lineId)).toEqual(['line-in-cat'])
  })

  it('tiered_discount limitToCategoryId narrows the candidate set the same way', () => {
    const b = benefit('tiered_discount', 'line', {
      limitToCategoryId: 'cat-1',
      tiers: [],
      selector: 'cart_order',
      maxQuantity: null,
      maxLines: null,
      quantityStep: null,
      nthPosition: null,
    })
    const items = [
      item({ lineId: 'line-out', productId: 'p1', quantity: '1', categoryIds: ['cat-2'] }),
      item({ lineId: 'line-in', productId: 'p2', quantity: '1', categoryIds: ['cat-1'] }),
    ]
    const result = selectUnits(b, context({ items }))
    expect(result.lines.map((l) => l.lineId)).toEqual(['line-in'])
  })
})

describe('buy_x_get_y qualifying set is the reward side, not the trigger side', () => {
  it('a trigger-matching item that is not the reward product is never selected; the reward-matching item is', () => {
    const b = benefit('buy_x_get_y', 'unit', {
      triggerProductId: 'trigger-product',
      triggerCategoryId: null,
      triggerQuantity: 2,
      rewardProductId: 'reward-product',
      rewardVariantId: null,
      rewardQuantity: 1,
      selector: 'cart_order',
      maxQuantity: null,
      maxLines: null,
      quantityStep: null,
      nthPosition: null,
    })
    const items = [
      item({ lineId: 'line-trigger', productId: 'trigger-product', quantity: '2' }),
      item({ lineId: 'line-reward', productId: 'reward-product', quantity: '1' }),
    ]
    const result = selectUnits(b, context({ items }))
    expect(result.lines.map((l) => l.lineId)).toEqual(['line-reward'])
  })
})

describe('tie-break determinism (TC-PROM-064)', () => {
  it('two lines tying on unit price are always ordered by lineId ascending, across repeated calls', () => {
    const b = benefit('product_discount', 'line', {
      productId: null,
      limitToCategoryId: null,
      selector: 'cheapest',
      maxQuantity: null,
      maxLines: 1,
      quantityStep: null,
      nthPosition: null,
    })
    // Declared out of lineId order on purpose — the array position must not decide the
    // tie-break.
    const items = [
      item({ lineId: 'line-z', productId: 'p1', quantity: '1', unitPriceNet: '10.00' }),
      item({ lineId: 'line-a', productId: 'p1', quantity: '1', unitPriceNet: '10.00' }),
    ]
    const ctx = context({ items })
    const first = selectUnits(b, ctx)
    const second = selectUnits(b, ctx)
    expect(first).toEqual(second)
    expect(first.lines.map((l) => l.lineId)).toEqual(['line-a'])
  })
})
