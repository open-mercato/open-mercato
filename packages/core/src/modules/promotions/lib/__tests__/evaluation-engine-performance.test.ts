// Step 2.8 — benchmark on the pure in-process evaluation engine
// (`evaluatePromotions`, `lib/evaluation-engine.ts`). Per PLAN.md's Step 2.8 row:
// "benchmark at 200 promotions × 50 lines (P95 ≤ 150 ms)". Deliberately NOT an HTTP
// round-trip test — this module's own performance gates are always scoped to the
// in-process pipeline (no network/DB), and 150ms for 200 promotions × 50 lines would be
// meaningless as a budget if it included real I/O. No DB, no EntityManager — the
// `NormalizedPromotion[]` / `EvaluationInput` fixtures below are plain objects, exactly
// what `evaluatePromotions` actually receives in production (built upstream by
// `services/promotion-cache.ts`, which this test does not exercise).

import { evaluatePromotions } from '../evaluation-engine'
import type { EnrichedEvaluateItem, EvaluationInput, NormalizedPromotion } from '../types'

const PROMOTION_COUNT = 200
const LINE_COUNT = 50
const SAMPLE_RUNS = 25
const P95_BUDGET_MS = 150

const PRODUCT_POOL = Array.from({ length: LINE_COUNT }, (_, i) => `perf-product-${i}`)
const CATEGORY_POOL = Array.from({ length: 10 }, (_, i) => `perf-category-${i}`)
const CUSTOMER_GROUP_POOL = Array.from({ length: 5 }, (_, i) => `perf-group-${i}`)

// A realistic mix of the rule types the real evaluator dispatch switch handles — not 200
// copies of the same trivial rule — so the benchmark actually exercises
// `rule-evaluators.ts`'s dispatch overhead across types.
const RULE_TYPE_CYCLE = ['order_value', 'product', 'category', 'customer_group'] as const
// Mix of benefit types, including one (`product_discount`) that routes through
// `unit-selection.ts`'s selector/cap machinery, and one (`cart_discount`) that does not —
// exercising both of `effect-resolvers.ts`'s major code paths.
const BENEFIT_TYPE_CYCLE = ['product_discount', 'cart_discount'] as const

function buildRule(index: number): NormalizedPromotion['rootGroup']['rules'][number] {
  const type = RULE_TYPE_CYCLE[index % RULE_TYPE_CYCLE.length]
  switch (type) {
    case 'order_value':
      return { type, config: { value: '50.00', operator: 'gte', taxInclusive: false, limitToCategory: null } }
    case 'product':
      return { type, config: { productId: PRODUCT_POOL[index % PRODUCT_POOL.length], variantId: null, quantity: 1, operator: 'gte' } }
    case 'category':
      return { type, config: { categoryId: CATEGORY_POOL[index % CATEGORY_POOL.length], quantity: 1, operator: 'gte' } }
    case 'customer_group':
      return { type, config: { customerGroupId: CUSTOMER_GROUP_POOL[index % CUSTOMER_GROUP_POOL.length] } }
    default:
      throw new Error(`[internal] unreachable rule type ${type}`)
  }
}

function buildBenefit(index: number): NormalizedPromotion['rootGroup']['benefits'][number] {
  const type = BENEFIT_TYPE_CYCLE[index % BENEFIT_TYPE_CYCLE.length]
  if (type === 'product_discount') {
    return {
      type,
      appliesTo: 'line',
      config: {
        productId: PRODUCT_POOL[index % PRODUCT_POOL.length],
        limitToCategoryId: null,
        discountType: index % 3 === 0 ? 'fixed' : 'percentage',
        value: index % 3 === 0 ? '2.00' : '10',
        maxDiscount: null,
        maxQuantity: null,
        maxLines: null,
        quantityStep: null,
        selector: 'all',
        nthPosition: null,
        labels: { en: `Perf discount ${index}` },
      },
    }
  }
  return {
    type,
    appliesTo: 'order',
    config: { discountType: 'percentage', value: '5', maxDiscount: null, labels: { en: `Perf cart discount ${index}` } },
  }
}

// Readable, reusable generator producing 200 varied-but-deterministic promotion
// fixtures by index, rather than 200 hand-written literal objects.
function buildPromotion(index: number): NormalizedPromotion {
  return {
    id: `perf-promo-${index}`,
    name: `Perf Promotion ${index}`,
    order: index,
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
    rootGroup: {
      operator: 'and',
      rules: [buildRule(index)],
      benefits: [buildBenefit(index)],
      children: [],
    },
  }
}

function buildItem(index: number): EnrichedEvaluateItem {
  return {
    lineId: `perf-line-${index}`,
    productId: PRODUCT_POOL[index % PRODUCT_POOL.length],
    variantId: null,
    quantity: '2',
    unitPriceNet: '10.00',
    unitPriceGross: '12.30',
    priceIsPromotional: false,
    categoryIds: [CATEGORY_POOL[index % CATEGORY_POOL.length]],
    attributes: {},
  }
}

function buildInput(): EvaluationInput {
  return {
    items: Array.from({ length: LINE_COUNT }, (_, i) => buildItem(i)),
    currency: 'USD',
    evaluatedAt: '2026-06-15T00:00:00.000Z',
    buyer: { customerId: null, customerIds: [], customerGroupIds: [CUSTOMER_GROUP_POOL[0]] },
    customerOrderCount: 3,
    cartWeight: '12.5',
    codes: [],
  }
}

function computeP95(durationsMs: number[]): number {
  const sorted = [...durationsMs].sort((a, b) => a - b)
  const rank = Math.ceil(0.95 * sorted.length) - 1
  return sorted[Math.min(rank, sorted.length - 1)]
}

describe('evaluatePromotions — performance benchmark (Step 2.8)', () => {
  it(`evaluates ${PROMOTION_COUNT} promotions x ${LINE_COUNT} lines with P95 <= ${P95_BUDGET_MS}ms`, () => {
    const promotions = Array.from({ length: PROMOTION_COUNT }, (_, i) => buildPromotion(i))
    const input = buildInput()

    const durationsMs: number[] = []
    for (let run = 0; run < SAMPLE_RUNS; run += 1) {
      const startedAt = performance.now()
      const result = evaluatePromotions(promotions, input)
      durationsMs.push(performance.now() - startedAt)
      // Every promotion is cumulative, so every one of the 200 promotions is evaluated
      // on every run (no early `break`) — sanity-checks the benchmark is not accidentally
      // measuring a short-circuited loop.
      expect(result.appliedPromotions.length).toBeGreaterThan(0)
    }

    const p95 = computeP95(durationsMs)
    // eslint-disable-next-line no-console
    console.log(
      `[evaluation-engine-performance] ${PROMOTION_COUNT}x${LINE_COUNT} P95=${p95.toFixed(3)}ms ` +
        `(min=${Math.min(...durationsMs).toFixed(3)}ms, max=${Math.max(...durationsMs).toFixed(3)}ms, runs=${SAMPLE_RUNS})`,
    )

    expect(p95).toBeLessThanOrEqual(P95_BUDGET_MS)
  })
})
