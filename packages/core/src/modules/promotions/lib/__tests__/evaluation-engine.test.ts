// Step 2.1 — orchestration-only coverage. `evaluateGroup` (lib/rule-evaluators.ts) and
// `resolveEffects` (lib/effect-resolvers.ts) are still throwing placeholders until Steps
// 2.2/2.3, so every test here must prove its promotion is skipped *before* Pass 1 is
// reached — none of these promotions ever match, and none of these tests exercise the
// true-match path (Pass 1 returning true, Pass 2/3 running, tags accumulating). Full
// end-to-end evaluation is Step 2.8's job.
//
// The excluded-tags check is the one exception to testing purely through
// `evaluatePromotions`: its `appliedTagsSoFar` input is, in the real engine, only ever
// populated by a promotion that already passed Pass 1 — which the current stub cannot
// do. So that check is exercised directly through the extracted `isPromotionEligible`
// predicate with a manually constructed tag list, never through a real match.

import { evaluatePromotions, isPromotionEligible } from '../evaluation-engine'
import type { EvaluateInput, NormalizedPromotion } from '../types'

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

function input(overrides: Partial<EvaluateInput> = {}): EvaluateInput {
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

  it('skips a promotion whose totalDiscountGranted already meets or exceeds maxBudget', () => {
    const result = evaluatePromotions(
      [promotion({ maxBudget: '100.00', budgetCurrency: 'USD', totalDiscountGranted: '150.00' })],
      input(),
    )
    expect(result).toEqual({ appliedPromotions: [] })
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
})
