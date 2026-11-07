// Step 2.1 — orchestration-only coverage, written while `evaluateGroup`
// (lib/rule-evaluators.ts) and `resolveEffects` (lib/effect-resolvers.ts) were still
// throwing placeholders, so every test in the first describe block below proves its
// promotion is skipped *before* Pass 1 is reached. The excluded-tags check was the one
// exception at the time, exercised directly through the extracted `isPromotionEligible`
// predicate with a manually constructed tag list rather than through a real match.
//
// Steps 2.2/2.3 later made Pass 1-3 real, which is what the "ordering, cumulativity, tag
// exclusion across REAL matching promotions" describe block at the bottom covers (Step
// 2.4's actual remaining scope — the logic itself already lived here since Step 2.1; see
// PLAN.md's Step 2.4 note). Step 2.8 still owns the comprehensive, spec-wide end-to-end
// suite; the block below is deliberately narrow, proving only the three orchestration
// properties Step 2.4 named.

import { evaluatePromotions, isPromotionEligible } from '../evaluation-engine'
import { clearableEndOfDayDateSchema } from '../../data/validators'
import type { EvaluationInput, NormalizedPromotion } from '../types'

function promotion(overrides: Partial<NormalizedPromotion> = {}): NormalizedPromotion {
  return {
    id: 'promo-1',
    name: 'Test Promotion',
    order: 0,
    cumulative: true,
    tags: [],
    excludedTags: [],
    excludeFlags: {},
    eligibleCurrencies: [],
    startsAt: null,
    endsAt: null,
    maxBudget: null,
    budgetCurrency: null,
    totalDiscountGranted: '0',
    rootGroup: { operator: 'and', rules: [], benefits: [], children: [] },
    ...overrides,
  }
}

function input(overrides: Partial<EvaluationInput> = {}): EvaluationInput {
  return {
    items: [],
    currency: 'USD',
    evaluatedAt: '2026-06-15T00:00:00.000Z',
    buyer: { customerId: null, customerIds: [], customerGroupIds: [] },
    customerOrderCount: null,
    cartWeight: null,
    codes: [],
    ...overrides,
  }
}

describe('evaluatePromotions — orchestration skip checks', () => {
  it('skips a promotion whose startsAt is after evaluatedAt', () => {
    const result = evaluatePromotions(
      [promotion({ startsAt: '2026-07-01T00:00:00.000Z' })],
      input({ evaluatedAt: '2026-06-15T00:00:00.000Z' }),
    )
    expect(result).toEqual({ appliedPromotions: [] })
  })

  it('skips a promotion whose endsAt is before evaluatedAt', () => {
    const result = evaluatePromotions(
      [promotion({ endsAt: '2026-06-01T00:00:00.000Z' })],
      input({ evaluatedAt: '2026-06-15T00:00:00.000Z' }),
    )
    expect(result).toEqual({ appliedPromotions: [] })
  })

  it('skips a promotion whose eligibleCurrencies excludes input.currency', () => {
    const result = evaluatePromotions(
      [promotion({ eligibleCurrencies: ['EUR'] })],
      input({ currency: 'USD' }),
    )
    expect(result).toEqual({ appliedPromotions: [] })
  })

  // TC-PROM-026 (Release 4 PLAN.md Step 6.8): the exclusion case above only proves half
  // of the currency-eligibility contract — this closes the gap by proving the promotion
  // is NOT skipped once `input.currency` is one of its `eligibleCurrencies`.
  it('includes a promotion whose eligibleCurrencies contains input.currency', () => {
    const result = evaluatePromotions(
      [promotion({ eligibleCurrencies: ['EUR'] })],
      input({ currency: 'EUR' }),
    )
    expect(result).toEqual({
      appliedPromotions: [{ promotionId: 'promo-1', promotionName: 'Test Promotion', effects: [] }],
    })
  })

  it('skips a promotion whose totalDiscountGranted already meets or exceeds maxBudget', () => {
    const result = evaluatePromotions(
      [promotion({ maxBudget: '100.00', budgetCurrency: 'USD', totalDiscountGranted: '150.00' })],
      input(),
    )
    expect(result).toEqual({ appliedPromotions: [] })
  })
})

// A promotion that actually matches (Pass 1 real), via the simplest real rule/benefit
// pairing available: a `code` rule (matches iff the caller's `codes` includes the
// configured `codeId`) and a `cart_discount` benefit (one CART_DISCOUNT effect, no unit
// selection involved) — neither needs cart items or category data, keeping these
// fixtures focused on the orchestration behavior under test, not rule/benefit math
// (already covered by `rule-evaluators.test.ts`/`effect-resolvers.test.ts`).
function matchingPromotion(overrides: Partial<NormalizedPromotion> & { codeId: string }): NormalizedPromotion {
  const { codeId, ...rest } = overrides
  return promotion({
    rootGroup: {
      operator: 'and',
      rules: [{ type: 'code', config: { codeId } }],
      benefits: [
        {
          type: 'cart_discount',
          appliesTo: 'order',
          config: { discountType: 'percentage', value: '10', maxDiscount: null, labels: { en: 'Test' } },
        },
      ],
      children: [],
    },
    ...rest,
  })
}

describe('evaluatePromotions — ordering, cumulativity, and tag exclusion across real matches (Step 2.4)', () => {
  it('applies every cumulative promotion that matches, in the order given', () => {
    const promoA = matchingPromotion({ id: 'promo-a', codeId: 'code-a', tags: ['seasonal'] })
    const promoB = matchingPromotion({ id: 'promo-b', codeId: 'code-b', tags: ['vip'] })

    const result = evaluatePromotions(
      [promoA, promoB],
      input({ codes: [{ id: 'code-a', type: 'static' }, { id: 'code-b', type: 'static' }] }),
    )

    expect(result.appliedPromotions.map((applied) => applied.promotionId)).toEqual(['promo-a', 'promo-b'])
  })

  it('a non-cumulative match stops evaluation — a later promotion that would also match is never applied', () => {
    const promoA = matchingPromotion({ id: 'promo-a', codeId: 'code-a', cumulative: false, tags: ['seasonal'] })
    const promoB = matchingPromotion({ id: 'promo-b', codeId: 'code-b', tags: ['vip'] })

    const result = evaluatePromotions(
      [promoA, promoB],
      input({ codes: [{ id: 'code-a', type: 'static' }, { id: 'code-b', type: 'static' }] }),
    )

    expect(result.appliedPromotions.map((applied) => applied.promotionId)).toEqual(['promo-a'])
  })

  it('a promotion excluded by an earlier real match\'s tags is skipped, even though its own rule would match', () => {
    const promoA = matchingPromotion({ id: 'promo-a', codeId: 'code-a', tags: ['seasonal'] })
    const promoC = matchingPromotion({ id: 'promo-c', codeId: 'code-c', excludedTags: ['seasonal'] })

    const result = evaluatePromotions(
      [promoA, promoC],
      input({ codes: [{ id: 'code-a', type: 'static' }, { id: 'code-c', type: 'static' }] }),
    )

    expect(result.appliedPromotions.map((applied) => applied.promotionId)).toEqual(['promo-a'])
  })

  it('evaluates in the given array order, never re-sorting by the `order` field itself', () => {
    // promo-b has a numerically lower `order` than promo-a, but is placed SECOND in the
    // input array — `evaluatePromotions` must follow array order (the cache's own
    // responsibility to pre-sort), proven here by making promo-a non-cumulative: if the
    // function re-sorted by `order`, promo-b (order 0) would run first and promo-a
    // (order 1) would never even be reached.
    const promoA = matchingPromotion({ id: 'promo-a', codeId: 'code-a', order: 1, cumulative: false })
    const promoB = matchingPromotion({ id: 'promo-b', codeId: 'code-b', order: 0 })

    const result = evaluatePromotions(
      [promoA, promoB],
      input({ codes: [{ id: 'code-a', type: 'static' }, { id: 'code-b', type: 'static' }] }),
    )

    expect(result.appliedPromotions.map((applied) => applied.promotionId)).toEqual(['promo-a'])
  })

  it('a real match produces a genuine ResolvedEffect, not an empty effects array', () => {
    const promoA = matchingPromotion({ id: 'promo-a', codeId: 'code-a' })
    const result = evaluatePromotions([promoA], input({ codes: [{ id: 'code-a', type: 'static' }] }))

    expect(result.appliedPromotions).toHaveLength(1)
    expect(result.appliedPromotions[0].effects).toEqual([
      { type: 'CART_DISCOUNT', appliesTo: 'order', currency: 'USD', label: { en: 'Test' }, amountNet: '0.00', amountGross: '0.00', basis: 'net' },
    ])
  })
})

// D-R5-17 (amends D-R4-14): a `delivery_method` rule gated promotion, end to end through
// the real engine — both passes together, not mocked (Pass 1 match + Pass 3 resolve).
function deliveryMatchingPromotion(overrides: Partial<NormalizedPromotion> = {}): NormalizedPromotion {
  return promotion({
    rootGroup: {
      operator: 'and',
      rules: [{ type: 'delivery_method', config: { deliveryMethodCode: 'standard' } }],
      benefits: [
        {
          type: 'delivery_discount',
          appliesTo: 'order',
          config: { deliveryMethodCode: 'standard', discountType: 'percentage', value: '50', labels: { en: 'Free delivery' } },
        },
      ],
      children: [],
    },
    ...overrides,
  })
}

describe('evaluatePromotions — delivery promotions (D-R5-17, amends D-R4-14)', () => {
  it('matches the delivery_method rule and resolves a DELIVERY_DISCOUNT effect when the caller supplies delivery context', () => {
    const promo = deliveryMatchingPromotion()
    const result = evaluatePromotions([promo], input({ deliveryMethodCode: 'standard', deliveryCost: '10.00' }))

    expect(result.appliedPromotions).toHaveLength(1)
    expect(result.appliedPromotions[0].effects).toEqual([
      {
        type: 'DELIVERY_DISCOUNT',
        appliesTo: 'order',
        currency: 'USD',
        label: { en: 'Free delivery' },
        deliveryMethodCode: 'standard',
        amountNet: '-5.00',
        amountGross: '-5.00',
        basis: 'net',
      },
    ])
  })

  // Regression guard: every existing caller (cart's own reprice phase) calls `evaluate`
  // with no delivery context at all — D-R4-14's cart-stage exclusion of delivery from
  // totals must stay exactly as it was before D-R5-17 un-hid the rule/effect.
  it('never matches the promotion at all when the caller omits delivery context (cart-stage regression guard)', () => {
    const promo = deliveryMatchingPromotion()
    const result = evaluatePromotions([promo], input())

    expect(result.appliedPromotions).toEqual([])
  })
})

describe('isPromotionEligible — excluded-tags check', () => {
  it('returns false when excludedTags intersects the running appliedTags set', () => {
    const eligible = isPromotionEligible(
      promotion({ excludedTags: ['vip'] }),
      input(),
      ['vip', 'seasonal'],
    )
    expect(eligible).toBe(false)
  })

  it('returns true when excludedTags does not intersect the running appliedTags set', () => {
    const eligible = isPromotionEligible(
      promotion({ excludedTags: ['clearance'] }),
      input(),
      ['vip', 'seasonal'],
    )
    expect(eligible).toBe(true)
  })

  it('returns true when appliedTags is empty regardless of excludedTags', () => {
    const eligible = isPromotionEligible(promotion({ excludedTags: ['vip'] }), input(), [])
    expect(eligible).toBe(true)
  })

  // QA F7 (Medium, confirmed live): proves the write-side fix (`clearableEndOfDayDateSchema`
  // in `data/validators.ts`) closes the gap end-to-end, without changing this function's
  // own comparison (`evaluatedAtMs > endsAtMs`), which is correct once `endsAt` already
  // represents the end of the valid window. `endOfDayEndsAt` mirrors what the schema now
  // stores for a date-only "ends Oct 16" admin input.
  describe('date-only endsAt is inclusive through end of day (QA F7)', () => {
    const endOfDayEndsAt = clearableEndOfDayDateSchema.parse('2026-10-16')!.toISOString()

    it('is still eligible at 23:00 on the same day the promotion ends', () => {
      const eligible = isPromotionEligible(
        promotion({ endsAt: endOfDayEndsAt }),
        input({ evaluatedAt: '2026-10-16T23:00:00.000Z' }),
        [],
      )
      expect(eligible).toBe(true)
    })

    it('is no longer eligible on the day after the promotion ends', () => {
      const eligible = isPromotionEligible(
        promotion({ endsAt: endOfDayEndsAt }),
        input({ evaluatedAt: '2026-10-17T00:00:01.000Z' }),
        [],
      )
      expect(eligible).toBe(false)
    })
  })
})
