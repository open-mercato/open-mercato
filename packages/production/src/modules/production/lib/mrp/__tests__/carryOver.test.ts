export {}

import { computeCarryOverDecisions, buildSuggestionMatchKey, matchKeyForEngineSuggestion } from '../carryOver'
import type { MrpSuggestion as EngineSuggestion } from '../types'

/**
 * Task 5.2 — carry-over matching (TDD, `[tdd:required]`).
 * Pure-function contract for `persistSuggestions.ts` (no `em`/DB here).
 */

function engineSuggestion(overrides: Partial<EngineSuggestion> = {}): EngineSuggestion {
  return {
    type: 'make',
    productKey: 'p1::',
    productId: 'p1',
    variantId: null,
    qty: 10,
    uom: 'pcs',
    dueDate: '2026-02-01',
    pegging: [{ productKey: 'p1::', source: { type: 'sales_order', id: 'so-1' }, qty: 10 }],
    ...overrides,
  }
}

describe('buildSuggestionMatchKey / matchKeyForEngineSuggestion', () => {
  it('is stable for the same (type, product, variant, demandSource) tuple', () => {
    const a = buildSuggestionMatchKey({
      suggestionType: 'make',
      productId: 'p1',
      variantId: null,
      demandSourceKey: 'sales_order:so-1',
    })
    const b = matchKeyForEngineSuggestion(engineSuggestion())
    expect(a).toBe(b)
  })

  it('differs when the suggestion type differs', () => {
    const make = matchKeyForEngineSuggestion(engineSuggestion({ type: 'make' }))
    const buy = matchKeyForEngineSuggestion(engineSuggestion({ type: 'buy' }))
    expect(make).not.toBe(buy)
  })

  it('differs when the variant differs', () => {
    const noVariant = matchKeyForEngineSuggestion(engineSuggestion({ variantId: null }))
    const withVariant = matchKeyForEngineSuggestion(
      engineSuggestion({ variantId: 'v1', productKey: 'p1::v1' }),
    )
    expect(noVariant).not.toBe(withVariant)
  })

  it('differs when the demand source id differs (different sales order)', () => {
    const first = matchKeyForEngineSuggestion(
      engineSuggestion({ pegging: [{ productKey: 'p1::', source: { type: 'sales_order', id: 'so-1' }, qty: 10 }] }),
    )
    const second = matchKeyForEngineSuggestion(
      engineSuggestion({ pegging: [{ productKey: 'p1::', source: { type: 'sales_order', id: 'so-2' }, qty: 10 }] }),
    )
    expect(first).not.toBe(second)
  })

  it('REGRESSION: is stable across ALL pegging refs regardless of their order (not just pegging[0])', () => {
    const forward = matchKeyForEngineSuggestion(
      engineSuggestion({
        pegging: [
          { productKey: 'p1::', source: { type: 'sales_order', id: 'so-1' }, qty: 4 },
          { productKey: 'p1::', source: { type: 'sales_order', id: 'so-2' }, qty: 6 },
        ],
      }),
    )
    const reversed = matchKeyForEngineSuggestion(
      engineSuggestion({
        pegging: [
          { productKey: 'p1::', source: { type: 'sales_order', id: 'so-2' }, qty: 6 },
          { productKey: 'p1::', source: { type: 'sales_order', id: 'so-1' }, qty: 4 },
        ],
      }),
    )
    expect(forward).toBe(reversed)
  })
})

describe('computeCarryOverDecisions', () => {
  it('marks a new suggestion matching a prior ACCEPTED suggestion as superseded with carriedFromSuggestionId set', () => {
    const suggestion = engineSuggestion()
    const decisions = computeCarryOverDecisions(
      [suggestion],
      [
        {
          id: 'prior-1',
          suggestionType: 'make',
          productId: 'p1',
          variantId: null,
          demandSourceKey: 'sales_order:so-1',
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ],
    )
    expect(decisions).toHaveLength(1)
    expect(decisions[0].status).toBe('superseded')
    expect(decisions[0].carriedFromSuggestionId).toBe('prior-1')
  })

  it('marks a new suggestion matching a prior DISMISSED suggestion as superseded (no re-emitted noise)', () => {
    const suggestion = engineSuggestion()
    const decisions = computeCarryOverDecisions(
      [suggestion],
      [
        {
          id: 'prior-2',
          suggestionType: 'make',
          productId: 'p1',
          variantId: null,
          demandSourceKey: 'sales_order:so-1',
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ],
    )
    expect(decisions[0].status).toBe('superseded')
    expect(decisions[0].carriedFromSuggestionId).toBe('prior-2')
  })

  it('leaves a suggestion with no prior resolved match as open with no carriedFromSuggestionId', () => {
    const suggestion = engineSuggestion()
    const decisions = computeCarryOverDecisions([suggestion], [])
    expect(decisions[0].status).toBe('open')
    expect(decisions[0].carriedFromSuggestionId).toBeNull()
  })

  it('when two prior resolved rows share a match key, uses the most recently created one', () => {
    const suggestion = engineSuggestion()
    const decisions = computeCarryOverDecisions(
      [suggestion],
      [
        {
          id: 'older',
          suggestionType: 'make',
          productId: 'p1',
          variantId: null,
          demandSourceKey: 'sales_order:so-1',
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
        {
          id: 'newer',
          suggestionType: 'make',
          productId: 'p1',
          variantId: null,
          demandSourceKey: 'sales_order:so-1',
          createdAt: new Date('2026-02-01T00:00:00Z'),
        },
      ],
    )
    expect(decisions[0].carriedFromSuggestionId).toBe('newer')
  })
})
