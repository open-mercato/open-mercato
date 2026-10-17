// Step 2.2 — real per-rule-type evaluators plus AND/OR group composition (SPEC-055
// §Evaluation Engine Data Flow Pass 1, §Data Models "Rule" table). All fixtures are
// pure in-memory objects — no DB, no helpers needed.

import { evaluateGroup } from '../rule-evaluators'
import type { EnrichedEvaluateItem, EvaluationContext, NormalizedRule, NormalizedRuleGroup } from '../types'

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

function group(overrides: Partial<NormalizedRuleGroup> = {}): NormalizedRuleGroup {
  return {
    operator: 'and',
    rules: [],
    benefits: [],
    children: [],
    ...overrides,
  }
}

function rule(type: string, config: Record<string, unknown>): NormalizedRule {
  return { type, config }
}

describe('evaluateGroup — AND/OR composition', () => {
  it('AND passes when every rule is true', () => {
    const g = group({
      operator: 'and',
      rules: [rule('code', { codeId: 'code-1' }), rule('code', { codeId: 'code-1' })],
    })
    const ctx = context({ codes: [{ id: 'code-1', type: 'static' }] })
    expect(evaluateGroup(g, ctx)).toBe(true)
  })

  it('AND fails when one rule is false', () => {
    const g = group({
      operator: 'and',
      rules: [rule('code', { codeId: 'code-1' }), rule('code', { codeId: 'code-2' })],
    })
    const ctx = context({ codes: [{ id: 'code-1', type: 'static' }] })
    expect(evaluateGroup(g, ctx)).toBe(false)
  })

  it('OR passes when one rule is true', () => {
    const g = group({
      operator: 'or',
      rules: [rule('code', { codeId: 'code-1' }), rule('code', { codeId: 'code-2' })],
    })
    const ctx = context({ codes: [{ id: 'code-1', type: 'static' }] })
    expect(evaluateGroup(g, ctx)).toBe(true)
  })

  it('OR fails when every rule is false', () => {
    const g = group({
      operator: 'or',
      rules: [rule('code', { codeId: 'code-2' }), rule('code', { codeId: 'code-3' })],
    })
    const ctx = context({ codes: [{ id: 'code-1', type: 'static' }] })
    expect(evaluateGroup(g, ctx)).toBe(false)
  })

  it('combines rules and a nested child group result together, recursing with the child\'s own operator', () => {
    const g = group({
      operator: 'and',
      rules: [rule('code', { codeId: 'code-1' })],
      children: [
        group({
          operator: 'or',
          rules: [rule('code', { codeId: 'code-missing' }), rule('code', { codeId: 'code-1' })],
        }),
      ],
    })
    const ctx = context({ codes: [{ id: 'code-1', type: 'static' }] })
    expect(evaluateGroup(g, ctx)).toBe(true)
  })

  it('a false nested child group fails the parent AND even when the parent\'s own rules are true', () => {
    const g = group({
      operator: 'and',
      rules: [rule('code', { codeId: 'code-1' })],
      children: [
        group({
          operator: 'or',
          rules: [rule('code', { codeId: 'code-missing' }), rule('code', { codeId: 'code-also-missing' })],
        }),
      ],
    })
    const ctx = context({ codes: [{ id: 'code-1', type: 'static' }] })
    expect(evaluateGroup(g, ctx)).toBe(false)
  })

  it('an empty group evaluates true under AND (vacuous truth)', () => {
    const g = group({ operator: 'and', rules: [], children: [] })
    expect(evaluateGroup(g, context())).toBe(true)
  })

  it('an empty group evaluates false under OR (vacuous falsehood)', () => {
    const g = group({ operator: 'or', rules: [], children: [] })
    expect(evaluateGroup(g, context())).toBe(false)
  })
})

describe('evaluateGroup — unrecognized rule type fails closed', () => {
  it('evaluates false instead of throwing for a hidden/unknown rule type', () => {
    const g = group({
      operator: 'or',
      rules: [rule('producer', { producerCode: 'acme', quantity: 1, operator: 'eq' })],
    })
    expect(() => evaluateGroup(g, context())).not.toThrow()
    expect(evaluateGroup(g, context())).toBe(false)
  })
})

describe('order_value rule', () => {
  it('passes when the net order total matches the configured threshold', () => {
    const g = group({
      rules: [rule('order_value', { value: '20.00', operator: 'eq', taxInclusive: false, limitToCategory: null })],
    })
    const ctx = context({ items: [item({ quantity: '2', unitPriceNet: '10.00' })] })
    expect(evaluateGroup(g, ctx)).toBe(true)
  })

  it('fails when the net order total does not match', () => {
    const g = group({
      rules: [rule('order_value', { value: '25.00', operator: 'eq', taxInclusive: false, limitToCategory: null })],
    })
    const ctx = context({ items: [item({ quantity: '2', unitPriceNet: '10.00' })] })
    expect(evaluateGroup(g, ctx)).toBe(false)
  })
})

describe('order_date rule', () => {
  it('passes when evaluatedAt matches the configured date', () => {
    const g = group({ rules: [rule('order_date', { date: '2026-06-15', operator: 'eq' })] })
    const ctx = context({ evaluatedAt: '2026-06-15T00:00:00.000Z' })
    expect(evaluateGroup(g, ctx)).toBe(true)
  })

  it('fails when evaluatedAt does not match the configured date', () => {
    const g = group({ rules: [rule('order_date', { date: '2026-06-16', operator: 'eq' })] })
    const ctx = context({ evaluatedAt: '2026-06-15T00:00:00.000Z' })
    expect(evaluateGroup(g, ctx)).toBe(false)
  })
})

describe('product_count rule', () => {
  it('passes when the summed quantity matches', () => {
    const g = group({ rules: [rule('product_count', { value: 5, operator: 'eq' })] })
    const ctx = context({ items: [item({ quantity: '3' }), item({ quantity: '2' })] })
    expect(evaluateGroup(g, ctx)).toBe(true)
  })

  it('fails when the summed quantity does not match', () => {
    const g = group({ rules: [rule('product_count', { value: 6, operator: 'eq' })] })
    const ctx = context({ items: [item({ quantity: '3' }), item({ quantity: '2' })] })
    expect(evaluateGroup(g, ctx)).toBe(false)
  })
})

describe('cart_weight rule', () => {
  it('passes when cartWeight matches the configured threshold', () => {
    const g = group({ rules: [rule('cart_weight', { value: '10.5', operator: 'eq' })] })
    const ctx = context({ cartWeight: '10.5' })
    expect(evaluateGroup(g, ctx)).toBe(true)
  })

  it('fails (never throws) when cartWeight is null — the unknowable-field convention', () => {
    const g = group({ rules: [rule('cart_weight', { value: '10.5', operator: 'eq' })] })
    const ctx = context({ cartWeight: null })
    expect(evaluateGroup(g, ctx)).toBe(false)
  })
})

describe('row_total rule', () => {
  it('passes when the net row total for the matching productId meets the threshold', () => {
    const g = group({
      rules: [rule('row_total', { value: '10.00', operator: 'eq', productId: 'p1', categoryId: null })],
    })
    const ctx = context({
      items: [item({ productId: 'p1', quantity: '2', unitPriceNet: '5.00' })],
    })
    expect(evaluateGroup(g, ctx)).toBe(true)
  })

  it('fails when no item matches the configured productId', () => {
    const g = group({
      rules: [rule('row_total', { value: '10.00', operator: 'eq', productId: 'p2', categoryId: null })],
    })
    const ctx = context({
      items: [item({ productId: 'p1', quantity: '2', unitPriceNet: '5.00' })],
    })
    expect(evaluateGroup(g, ctx)).toBe(false)
  })
})

describe('product rule', () => {
  it('passes when the summed quantity for the matching productId/variantId meets the threshold', () => {
    const g = group({
      rules: [rule('product', { productId: 'p1', variantId: null, quantity: 3, operator: 'eq' })],
    })
    const ctx = context({ items: [item({ productId: 'p1', variantId: null, quantity: '3' })] })
    expect(evaluateGroup(g, ctx)).toBe(true)
  })

  it('fails when no item matches the configured productId', () => {
    const g = group({
      rules: [rule('product', { productId: 'p2', variantId: null, quantity: 3, operator: 'eq' })],
    })
    const ctx = context({ items: [item({ productId: 'p1', variantId: null, quantity: '3' })] })
    expect(evaluateGroup(g, ctx)).toBe(false)
  })
})

describe('category rule', () => {
  it('passes using the pre-expanded categoryIds directly, without re-deriving ancestors', () => {
    const g = group({ rules: [rule('category', { categoryId: 'ancestor-cat', quantity: 4, operator: 'eq' })] })
    // `categoryIds` already carries the ancestor id (batch-enrichment convention) — the
    // evaluator must do a plain membership check, never its own tree walk.
    const ctx = context({ items: [item({ categoryIds: ['descendant-cat', 'ancestor-cat'], quantity: '4' })] })
    expect(evaluateGroup(g, ctx)).toBe(true)
  })

  it('fails when the configured categoryId is absent from every item\'s categoryIds', () => {
    const g = group({ rules: [rule('category', { categoryId: 'other-cat', quantity: 4, operator: 'eq' })] })
    const ctx = context({ items: [item({ categoryIds: ['descendant-cat', 'ancestor-cat'], quantity: '4' })] })
    expect(evaluateGroup(g, ctx)).toBe(false)
  })
})

describe('product_attribute rule', () => {
  it('passes when an item has the matching attribute value', () => {
    const g = group({ rules: [rule('product_attribute', { attributeCode: 'color', operator: 'eq', value: 'red' })] })
    const ctx = context({ items: [item({ attributes: { color: 'red' } })] })
    expect(evaluateGroup(g, ctx)).toBe(true)
  })

  it('fails when no item has the matching attribute value', () => {
    const g = group({ rules: [rule('product_attribute', { attributeCode: 'color', operator: 'eq', value: 'blue' })] })
    const ctx = context({ items: [item({ attributes: { color: 'red' } })] })
    expect(evaluateGroup(g, ctx)).toBe(false)
  })
})

describe('customer_group rule', () => {
  it('passes when the buyer belongs to the configured customer group', () => {
    const g = group({ rules: [rule('customer_group', { customerGroupId: 'g1' })] })
    const ctx = context({ buyer: { customerId: null, customerIds: [], customerGroupIds: ['g1'] } })
    expect(evaluateGroup(g, ctx)).toBe(true)
  })

  it('fails when the buyer does not belong to the configured customer group', () => {
    const g = group({ rules: [rule('customer_group', { customerGroupId: 'g2' })] })
    const ctx = context({ buyer: { customerId: null, customerIds: [], customerGroupIds: ['g1'] } })
    expect(evaluateGroup(g, ctx)).toBe(false)
  })
})

describe('customer_order_history rule', () => {
  it('passes when customerOrderCount satisfies the configured threshold', () => {
    const g = group({ rules: [rule('customer_order_history', { value: 3, operator: 'gte' })] })
    const ctx = context({ customerOrderCount: 5 })
    expect(evaluateGroup(g, ctx)).toBe(true)
  })

  it('fails (never throws) when customerOrderCount is null', () => {
    const g = group({ rules: [rule('customer_order_history', { value: 3, operator: 'gte' })] })
    const ctx = context({ customerOrderCount: null })
    expect(evaluateGroup(g, ctx)).toBe(false)
  })
})

describe('code rule', () => {
  it('passes when the configured codeId is present among the applied codes', () => {
    const g = group({ rules: [rule('code', { codeId: 'code-1' })] })
    const ctx = context({ codes: [{ id: 'code-1', type: 'static' }] })
    expect(evaluateGroup(g, ctx)).toBe(true)
  })

  it('fails when the configured codeId is absent', () => {
    const g = group({ rules: [rule('code', { codeId: 'code-2' })] })
    const ctx = context({ codes: [{ id: 'code-1', type: 'static' }] })
    expect(evaluateGroup(g, ctx)).toBe(false)
  })
})

describe('exclude_promotional_prices filter (D-R4-16)', () => {
  it('changes the order_value outcome depending on the flag', () => {
    const g = group({
      rules: [rule('order_value', { value: '50.00', operator: 'gte', taxInclusive: false, limitToCategory: null })],
    })
    const items = [
      item({ quantity: '1', unitPriceNet: '100.00', priceIsPromotional: true }),
      item({ quantity: '1', unitPriceNet: '5.00', priceIsPromotional: false }),
    ]

    const withFlagOff = context({ items, excludeFlags: {} })
    expect(evaluateGroup(g, withFlagOff)).toBe(true)

    const withFlagOn = context({ items, excludeFlags: { exclude_promotional_prices: true } })
    expect(evaluateGroup(g, withFlagOn)).toBe(false)
  })
})
