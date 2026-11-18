// Step 1.8: unit coverage for the pure "which states are reachable" logic the benefit
// card's Applies to / Limits / Which pieces controls are built on. Asserts that the
// five write-path rejection rules from `data/validators.ts`'s `checkQuantityCapRules`
// (mirrored in the header comment of `../benefitLimits.ts`) are unreachable by
// construction — not merely that a 422 would be returned for them.

import {
  applyAppliesToChange,
  applyNthToggleChange,
  applyQuantityCapChange,
  CAPPED_SELECTOR_OPTIONS,
  resolveBenefitLimitsState,
} from '../benefitLimits'

describe('resolveBenefitLimitsState', () => {
  it('hides the entire Limits row under appliesTo: order', () => {
    const state = resolveBenefitLimitsState('order', {})
    expect(state.showLimitsRow).toBe(false)
    expect(state.mode).toBe('none')
  })

  it('hides quantityStep under appliesTo: line but shows the rest of the Limits row', () => {
    const state = resolveBenefitLimitsState('line', { maxQuantity: 5 })
    expect(state.showLimitsRow).toBe(true)
    expect(state.showQuantityStep).toBe(false)
  })

  it('shows quantityStep under appliesTo: unit', () => {
    const state = resolveBenefitLimitsState('unit', {})
    expect(state.showQuantityStep).toBe(true)
  })

  it('never offers "all" or "nth" in the capped-mode selector options', () => {
    expect(CAPPED_SELECTOR_OPTIONS).not.toContain('all')
    expect(CAPPED_SELECTOR_OPTIONS).not.toContain('nth')
    expect(CAPPED_SELECTOR_OPTIONS).toEqual(['cart_order', 'cheapest', 'most_expensive'])
  })

  it('reports mode "capped" and disables the Nth toggle once a quantity cap is set', () => {
    const state = resolveBenefitLimitsState('unit', { maxQuantity: 5 })
    expect(state.mode).toBe('capped')
    expect(state.hasCap).toBe(true)
    expect(state.nthToggleDisabled).toBe(true)
  })

  it('reports mode "nth" and disables the cap inputs once selector is nth', () => {
    const state = resolveBenefitLimitsState('unit', { selector: 'nth', nthPosition: 3 })
    expect(state.mode).toBe('nth')
    expect(state.hasCap).toBe(false)
    expect(state.capInputsDisabled).toBe(true)
  })
})

describe('applyQuantityCapChange', () => {
  it('auto-assigns a selector the moment a cap gets a value (rejection rule 1: cap without selector)', () => {
    const next = applyQuantityCapChange({ selector: null }, 'maxQuantity', 5)
    expect(next.maxQuantity).toBe(5)
    expect(next.selector).toBe('cart_order')
  })

  it('keeps an existing capped-mode selector instead of overwriting it', () => {
    const next = applyQuantityCapChange({ selector: 'cheapest' }, 'maxQuantity', 5)
    expect(next.selector).toBe('cheapest')
  })

  it('overrides a stale "nth" selector and clears nthPosition (rejection rule 3: nth + cap)', () => {
    const next = applyQuantityCapChange({ selector: 'nth', nthPosition: 2 }, 'maxLines', 3)
    expect(next.selector).toBe('cart_order')
    expect(next.nthPosition).toBeNull()
  })

  it('clears selector and nthPosition once both caps are emptied', () => {
    const next = applyQuantityCapChange({ maxLines: null, selector: 'cheapest' }, 'maxQuantity', null)
    expect(next.selector).toBeNull()
    expect(next.nthPosition).toBeNull()
  })

  it('keeps the cap when the OTHER cap field still holds a value', () => {
    const next = applyQuantityCapChange({ maxLines: 2, selector: 'cheapest' }, 'maxQuantity', null)
    expect(next.selector).toBe('cheapest')
  })
})

describe('applyNthToggleChange', () => {
  it('always sets selector and nthPosition together (rejection rule 4: nth without nthPosition)', () => {
    const next = applyNthToggleChange({}, true)
    expect(next.selector).toBe('nth')
    expect(typeof next.nthPosition).toBe('number')
  })

  it('always clears both together when disabled', () => {
    const next = applyNthToggleChange({ selector: 'nth', nthPosition: 4 }, false)
    expect(next.selector).toBeNull()
    expect(next.nthPosition).toBeNull()
  })
})

describe('applyAppliesToChange', () => {
  it('clears every quantity-cap field when switching to "order" (nothing to count)', () => {
    const next = applyAppliesToChange('order', {
      maxQuantity: 5,
      maxLines: 2,
      quantityStep: 3,
      selector: 'cheapest',
      nthPosition: null,
    })
    expect(next).toMatchObject({ maxQuantity: null, maxLines: null, quantityStep: null, selector: null, nthPosition: null })
  })

  it('clears only quantityStep when switching to "line" (rejection rule 5)', () => {
    const next = applyAppliesToChange('line', { maxQuantity: 5, quantityStep: 3, selector: 'cart_order' })
    expect(next.quantityStep).toBeNull()
    expect(next.maxQuantity).toBe(5)
    expect(next.selector).toBe('cart_order')
  })

  it('leaves config untouched when switching to "unit"', () => {
    const config = { maxQuantity: 5, quantityStep: 3 }
    expect(applyAppliesToChange('unit', config)).toEqual(config)
  })
})
