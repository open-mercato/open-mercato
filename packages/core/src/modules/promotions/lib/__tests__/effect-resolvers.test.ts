// Step 2.3b — `resolveEffects` (SPEC-055 §Evaluation Engine Data Flow Pass 3, §API
// Contracts "Resolved Effect Types"/"Invariants", §Amendment — 2026-09-07, D-R4-7,
// D-R4-10). All fixtures are pure in-memory objects — no DB, no helpers needed.

import { resolveEffects } from '../effect-resolvers'
import type {
  AddFreeItemEffect,
  CartDiscountEffect,
  DeliveryDiscountEffect,
  EnrichedEvaluateItem,
  EvaluationContext,
  LineDiscountEffect,
  NormalizedBenefit,
} from '../types'

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

function benefit(type: string, appliesTo: 'order' | 'line' | 'unit', config: Record<string, unknown>): NormalizedBenefit {
  return { type, appliesTo, config }
}

const labels = { en: 'Promo' }

describe('cart_discount', () => {
  it('TC-PROM-014: a $1500 cart with value 10% and max_discount 100 caps amountNet at -100.00, not -150.00', () => {
    const b = benefit('cart_discount', 'order', { discountType: 'percentage', value: '10', maxDiscount: '100', labels })
    const ctx = context({ items: [item({ quantity: '1', unitPriceNet: '1500.00', unitPriceGross: '1500.00' })] })
    const effects = resolveEffects([b], ctx, 'promo-1')
    expect(effects).toHaveLength(1)
    const effect = effects[0] as CartDiscountEffect
    expect(effect.type).toBe('CART_DISCOUNT')
    expect(effect.amountNet).toBe('-100.00')
    expect(effect.amountGross).toBe('-100.00')
    expect(effect.basis).toBe('net')
  })

  it('percentage discount scales with the cart subtotal', () => {
    const b = benefit('cart_discount', 'order', { discountType: 'percentage', value: '20', maxDiscount: null, labels })
    const ctx = context({ items: [item({ quantity: '2', unitPriceNet: '50.00', unitPriceGross: '50.00' })] })
    const [effect] = resolveEffects([b], ctx, 'promo-1') as CartDiscountEffect[]
    expect(effect.amountNet).toBe('-20.00')
  })

  it('fixed discount is the full configured amount, never scaled by cart quantity', () => {
    const b = benefit('cart_discount', 'order', { discountType: 'fixed', value: '15', maxDiscount: null, labels })
    const ctx = context({ items: [item({ quantity: '3', unitPriceNet: '50.00', unitPriceGross: '50.00' })] })
    const [effect] = resolveEffects([b], ctx, 'promo-1') as CartDiscountEffect[]
    expect(effect.amountNet).toBe('-15.00')
  })

  it('still emits an effect for an empty cart, rounding to zero rather than omitting it', () => {
    const b = benefit('cart_discount', 'order', { discountType: 'percentage', value: '10', maxDiscount: null, labels })
    const effects = resolveEffects([b], context({ items: [] }), 'promo-1')
    expect(effects).toHaveLength(1)
    expect((effects[0] as CartDiscountEffect).amountNet).toBe('0.00')
  })
})

describe('product_discount', () => {
  it('emits one LINE_DISCOUNT per covered line, with correct appliedQuantity/amounts', () => {
    const b = benefit('product_discount', 'line', {
      productId: null,
      limitToCategoryId: null,
      discountType: 'percentage',
      value: '10',
      maxDiscount: null,
      labels,
      selector: 'cart_order',
      maxQuantity: null,
      maxLines: null,
      quantityStep: null,
      nthPosition: null,
    })
    const items = [
      item({ lineId: 'line-a', productId: 'p1', quantity: '2', unitPriceNet: '10.00', unitPriceGross: '12.00' }),
      item({ lineId: 'line-b', productId: 'p1', quantity: '3', unitPriceNet: '5.00', unitPriceGross: '6.00' }),
    ]
    const effects = resolveEffects([b], context({ items }), 'promo-1') as LineDiscountEffect[]
    expect(effects).toHaveLength(2)
    expect(effects[0]).toMatchObject({ targetLineId: 'line-a', appliedQuantity: 2, amountNet: '-2.00' })
    expect(effects[1]).toMatchObject({ targetLineId: 'line-b', appliedQuantity: 3, amountNet: '-1.50' })
  })

  it('max_discount binding across two covered lines scales both proportionally, not clamping only one', () => {
    const b = benefit('product_discount', 'line', {
      productId: null,
      limitToCategoryId: null,
      discountType: 'percentage',
      value: '10',
      maxDiscount: '10',
      labels,
      selector: 'cart_order',
      maxQuantity: null,
      maxLines: null,
      quantityStep: null,
      nthPosition: null,
    })
    const items = [
      item({ lineId: 'line-a', productId: 'p1', quantity: '2', unitPriceNet: '100.00', unitPriceGross: '100.00' }),
      item({ lineId: 'line-b', productId: 'p1', quantity: '1', unitPriceNet: '50.00', unitPriceGross: '50.00' }),
    ]
    // Raw: line-a -20.00, line-b -5.00, sum 25.00 > cap 10.00 → ratio 0.4 applied to both.
    const effects = resolveEffects([b], context({ items }), 'promo-1') as LineDiscountEffect[]
    expect(effects[0].amountNet).toBe('-8.00')
    expect(effects[1].amountNet).toBe('-2.00')
  })

  it('TC-PROM-065(a): max_quantity 4 binds before max_discount 100 — appliedQuantity 4, amountNet -40.00', () => {
    const b = benefit('product_discount', 'unit', {
      productId: null,
      limitToCategoryId: null,
      discountType: 'percentage',
      value: '50',
      maxDiscount: '100',
      labels,
      selector: 'cart_order',
      maxQuantity: 4,
      maxLines: null,
      quantityStep: null,
      nthPosition: null,
    })
    const items = [item({ lineId: 'line-a', productId: 'p1', quantity: '10', unitPriceNet: '20.00', unitPriceGross: '24.00' })]
    const [effect] = resolveEffects([b], context({ items }), 'promo-1') as LineDiscountEffect[]
    expect(effect.appliedQuantity).toBe(4)
    expect(effect.amountNet).toBe('-40.00')
    expect(effect.amountGross).toBe('-48.00')
  })

  it('TC-PROM-065(b): max_quantity 8 with max_discount 50 caps the amount, not the covered quantity', () => {
    const b = benefit('product_discount', 'unit', {
      productId: null,
      limitToCategoryId: null,
      discountType: 'percentage',
      value: '50',
      maxDiscount: '50',
      labels,
      selector: 'cart_order',
      maxQuantity: 8,
      maxLines: null,
      quantityStep: null,
      nthPosition: null,
    })
    const items = [item({ lineId: 'line-a', productId: 'p1', quantity: '10', unitPriceNet: '20.00', unitPriceGross: '24.00' })]
    const [effect] = resolveEffects([b], context({ items }), 'promo-1') as LineDiscountEffect[]
    // Raw amountNet would be -80.00 (8 × 20.00 × 50%); capped to -50.00. appliedQuantity
    // stays 8 — the cap reduces the amount granted, not the units covered.
    expect(effect.appliedQuantity).toBe(8)
    expect(effect.amountNet).toBe('-50.00')
    expect(effect.amountGross).toBe('-60.00')
  })

  it('emits no effect when selectUnits returns no qualifying lines', () => {
    const b = benefit('product_discount', 'line', {
      productId: 'does-not-exist',
      limitToCategoryId: null,
      discountType: 'percentage',
      value: '10',
      maxDiscount: null,
      labels,
      selector: 'cart_order',
      maxQuantity: null,
      maxLines: null,
      quantityStep: null,
      nthPosition: null,
    })
    const items = [item({ lineId: 'line-a', productId: 'p1', quantity: '1' })]
    expect(resolveEffects([b], context({ items }), 'promo-1')).toEqual([])
  })
})

describe('free_product', () => {
  it('a concrete productId emits ADD_FREE_ITEM carrying the promotionId marker', () => {
    const b = benefit('free_product', 'order', { productId: 'gift-product', categoryId: null, quantity: 2, labels })
    const [effect] = resolveEffects([b], context({ items: [] }), 'promo-42') as AddFreeItemEffect[]
    expect(effect).toMatchObject({
      type: 'ADD_FREE_ITEM',
      productId: 'gift-product',
      variantId: null,
      quantity: 2,
      reason: 'FREE_PRODUCT',
      promotionId: 'promo-42',
    })
  })

  it('a category-only config (no concrete productId) emits no effect', () => {
    const b = benefit('free_product', 'order', { productId: null, categoryId: 'cat-1', quantity: 1, labels })
    expect(resolveEffects([b], context({ items: [] }), 'promo-1')).toEqual([])
  })
})

describe('buy_x_get_y', () => {
  it('a 100%-off reward emits ADD_FREE_ITEM sized by the trigger math (trigger 2, reward 1, 6 triggering units → 3 applications)', () => {
    const b = benefit('buy_x_get_y', 'unit', {
      triggerProductId: 'trigger-product',
      triggerCategoryId: null,
      triggerQuantity: 2,
      rewardProductId: 'reward-product',
      rewardVariantId: null,
      rewardQuantity: 1,
      discountType: 'percentage',
      value: '100',
      maxApplications: null,
      maxDiscount: null,
      labels,
      selector: 'cart_order',
      maxQuantity: null,
      maxLines: null,
      quantityStep: null,
      nthPosition: null,
    })
    const items = [item({ lineId: 'line-trigger', productId: 'trigger-product', quantity: '6' })]
    const [effect] = resolveEffects([b], context({ items }), 'promo-1') as AddFreeItemEffect[]
    expect(effect).toMatchObject({ type: 'ADD_FREE_ITEM', productId: 'reward-product', quantity: 3, reason: 'BUY_X_GET_Y' })
  })

  it('maxApplications binds before the trigger-quantity math would otherwise allow more', () => {
    const b = benefit('buy_x_get_y', 'unit', {
      triggerProductId: 'trigger-product',
      triggerCategoryId: null,
      triggerQuantity: 2,
      rewardProductId: 'reward-product',
      rewardVariantId: null,
      rewardQuantity: 1,
      discountType: 'percentage',
      value: '100',
      maxApplications: 2,
      maxDiscount: null,
      labels,
      selector: 'cart_order',
      maxQuantity: null,
      maxLines: null,
      quantityStep: null,
      nthPosition: null,
    })
    // floor(10 / 2) = 5 applications uncapped; maxApplications: 2 binds first.
    const items = [item({ lineId: 'line-trigger', productId: 'trigger-product', quantity: '10' })]
    const [effect] = resolveEffects([b], context({ items }), 'promo-1') as AddFreeItemEffect[]
    expect(effect.quantity).toBe(2)
  })

  it('a partial discount (50%) discounts the existing reward line, intersecting the trigger entitlement with selectUnits own cap', () => {
    const b = benefit('buy_x_get_y', 'unit', {
      triggerProductId: 'trigger-product',
      triggerCategoryId: null,
      triggerQuantity: 2,
      rewardProductId: 'reward-product',
      rewardVariantId: null,
      rewardQuantity: 1,
      discountType: 'percentage',
      value: '50',
      maxApplications: null,
      maxDiscount: null,
      labels,
      selector: 'cart_order',
      maxQuantity: null,
      maxLines: null,
      quantityStep: null,
      nthPosition: null,
    })
    const items = [
      item({ lineId: 'line-trigger', productId: 'trigger-product', quantity: '6' }),
      item({ lineId: 'line-reward', productId: 'reward-product', quantity: '5', unitPriceNet: '10.00', unitPriceGross: '12.00' }),
    ]
    // 6 triggering units / 2 = 3 applications × 1 reward = entitlement 3, smaller than the
    // 5 units selectUnits would otherwise uncap-select on the reward line.
    const [effect] = resolveEffects([b], context({ items }), 'promo-1') as LineDiscountEffect[]
    expect(effect).toMatchObject({ targetLineId: 'line-reward', lineQuantity: 5, appliedQuantity: 3, amountNet: '-15.00' })
  })

  it('emits no effect when the trigger never fires', () => {
    const b = benefit('buy_x_get_y', 'unit', {
      triggerProductId: 'trigger-product',
      triggerCategoryId: null,
      triggerQuantity: 5,
      rewardProductId: 'reward-product',
      rewardVariantId: null,
      rewardQuantity: 1,
      discountType: 'percentage',
      value: '100',
      maxApplications: null,
      maxDiscount: null,
      labels,
      selector: 'cart_order',
      maxQuantity: null,
      maxLines: null,
      quantityStep: null,
      nthPosition: null,
    })
    const items = [item({ lineId: 'line-trigger', productId: 'trigger-product', quantity: '1' })]
    expect(resolveEffects([b], context({ items }), 'promo-1')).toEqual([])
  })
})

describe('tiered_discount', () => {
  it('picks the highest qualifying tier under applies_to: order', () => {
    const b = benefit('tiered_discount', 'order', {
      limitToCategoryId: null,
      tiers: [
        { threshold: '100', discountType: 'percentage', value: '5' },
        { threshold: '500', discountType: 'percentage', value: '10' },
      ],
      maxDiscount: null,
      labels,
      selector: 'cart_order',
      maxQuantity: null,
      maxLines: null,
      quantityStep: null,
      nthPosition: null,
    })
    const items = [item({ quantity: '3', unitPriceNet: '200.00', unitPriceGross: '200.00' })]
    const [effect] = resolveEffects([b], context({ items }), 'promo-1') as CartDiscountEffect[]
    expect(effect.type).toBe('CART_DISCOUNT')
    expect(effect.amountNet).toBe('-60.00')
  })

  it('picks the highest qualifying tier under applies_to: line, emitting a LINE_DISCOUNT', () => {
    const b = benefit('tiered_discount', 'line', {
      limitToCategoryId: null,
      tiers: [
        { threshold: '100', discountType: 'percentage', value: '5' },
        { threshold: '500', discountType: 'percentage', value: '10' },
      ],
      maxDiscount: null,
      labels,
      selector: 'cart_order',
      maxQuantity: null,
      maxLines: null,
      quantityStep: null,
      nthPosition: null,
    })
    const items = [item({ lineId: 'line-a', quantity: '3', unitPriceNet: '200.00', unitPriceGross: '200.00' })]
    const [effect] = resolveEffects([b], context({ items }), 'promo-1') as LineDiscountEffect[]
    expect(effect.type).toBe('LINE_DISCOUNT')
    expect(effect).toMatchObject({ targetLineId: 'line-a', appliedQuantity: 3, amountNet: '-60.00' })
  })

  it('emits no effect when the base amount is below every tier threshold', () => {
    const b = benefit('tiered_discount', 'order', {
      limitToCategoryId: null,
      tiers: [{ threshold: '1000', discountType: 'percentage', value: '10' }],
      maxDiscount: null,
      labels,
      selector: 'cart_order',
      maxQuantity: null,
      maxLines: null,
      quantityStep: null,
      nthPosition: null,
    })
    const items = [item({ quantity: '1', unitPriceNet: '50.00', unitPriceGross: '50.00' })]
    expect(resolveEffects([b], context({ items }), 'promo-1')).toEqual([])
  })
})

describe('delivery_discount (D-R5-17, amends D-R4-14) and unrecognized types', () => {
  it('returns no effect when the context carries no delivery method/cost (regression: every cart-stage caller omits both)', () => {
    const b = benefit('delivery_discount', 'order', { deliveryMethodCode: 'standard', discountType: 'percentage', value: '10', labels })
    expect(resolveEffects([b], context({ items: [] }), 'promo-1')).toEqual([])
  })

  it('returns no effect when the context delivery method does not match the benefit config', () => {
    const b = benefit('delivery_discount', 'order', { deliveryMethodCode: 'standard', discountType: 'percentage', value: '10', labels })
    const ctx = context({ items: [], deliveryMethodCode: 'express', deliveryCost: '20.00' })
    expect(resolveEffects([b], ctx, 'promo-1')).toEqual([])
  })

  it('resolves a DELIVERY_DISCOUNT effect when the context delivery method matches and a cost is supplied', () => {
    const b = benefit('delivery_discount', 'order', { deliveryMethodCode: 'standard', discountType: 'percentage', value: '10', labels })
    const ctx = context({ items: [], deliveryMethodCode: 'standard', deliveryCost: '20.00' })
    const effects = resolveEffects([b], ctx, 'promo-1')
    expect(effects).toHaveLength(1)
    const effect = effects[0] as DeliveryDiscountEffect
    expect(effect.type).toBe('DELIVERY_DISCOUNT')
    expect(effect.deliveryMethodCode).toBe('standard')
    expect(effect.amountNet).toBe('-2.00')
    expect(effect.amountGross).toBe('-2.00')
  })

  it('a fixed delivery_discount is clamped to the delivery cost, never exceeding it', () => {
    const b = benefit('delivery_discount', 'order', { deliveryMethodCode: 'standard', discountType: 'fixed', value: '100', labels })
    const ctx = context({ items: [], deliveryMethodCode: 'standard', deliveryCost: '9.99' })
    const effects = resolveEffects([b], ctx, 'promo-1')
    expect(effects).toHaveLength(1)
    const effect = effects[0] as DeliveryDiscountEffect
    expect(effect.amountNet).toBe('-9.99')
    expect(effect.amountGross).toBe('-9.99')
  })

  it('an unrecognized benefit type returns no effect without throwing', () => {
    const b = benefit('something_new', 'order', {})
    expect(() => resolveEffects([b], context({ items: [] }), 'promo-1')).not.toThrow()
    expect(resolveEffects([b], context({ items: [] }), 'promo-1')).toEqual([])
  })
})

describe('rounding — true half-up, not Math.round half-away-from-zero-for-positives-only', () => {
  it('a raw amount of exactly -2.50 at 0 fraction digits rounds to -3, not -2', () => {
    const b = benefit('cart_discount', 'order', { discountType: 'fixed', value: '2.5', maxDiscount: null, labels })
    // A non-empty cart with a base well above the discount value — the base-amount clamp
    // (review finding: a fixed discount must never exceed its base) must not interfere
    // with this test's own concern, the half-up rounding boundary.
    const ctx = context({ items: [item()], currencyFractionDigits: 0 })
    const [effect] = resolveEffects([b], ctx, 'promo-1') as CartDiscountEffect[]
    expect(effect.amountNet).toBe('-3')
  })
})
