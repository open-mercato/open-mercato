// Step 1.8: unit coverage for the benefit card's plain-language echo line. Splits the
// assertions across the pure descriptor builder (`computeBenefitEchoDescriptor`, no
// i18n) and the render step (`renderBenefitEcho`, using the real `{{var}}`
// interpolation a production `t()` performs) so a future i18n refactor cannot silently
// change what the descriptor itself claims the UI should say.

import { computeBenefitEchoDescriptor, renderBenefitEcho, type EchoTranslate } from '../benefitEcho'
import type { AppliesToId, BenefitTypeId, LocalBenefitNode } from '../ruleTreeTypes'

function benefit(benefitType: BenefitTypeId, appliesTo: AppliesToId, config: Record<string, unknown>): Pick<LocalBenefitNode, 'benefitType' | 'appliesTo' | 'config'> {
  return { benefitType, appliesTo, config }
}

// Mirrors the real translator's `(key, fallback, params)` contract, interpolating
// `{{var}}` the same way `@open-mercato/shared/lib/i18n/context`'s `format()` does.
const t: EchoTranslate = (_key, fallback, params) => {
  if (!params) return fallback
  return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name) => (params[name] !== undefined ? String(params[name]) : _match))
}

describe('computeBenefitEchoDescriptor', () => {
  it('reads a percentage discount, a quantity cap with cart_order, and max_discount', () => {
    const descriptor = computeBenefitEchoDescriptor(
      benefit('buy_x_get_y', 'unit', { discountType: 'percentage', value: '20', maxQuantity: 5, selector: 'cart_order', maxDiscount: '50' }),
    )
    expect(descriptor).toMatchObject({
      kind: 'discount',
      discountType: 'percentage',
      value: '20',
      upTo: false,
      maxDiscount: '50',
      scope: { kind: 'firstAdded', n: 5, noun: 'pieces', step: null },
    })
  })

  it('reads the whole-order scope for an order-targeted benefit', () => {
    const descriptor = computeBenefitEchoDescriptor(benefit('cart_discount', 'order', { discountType: 'fixed', value: '10' }))
    expect(descriptor.scope).toEqual({ kind: 'order' })
  })

  it('reads the nth-position scope independent of any quantity cap', () => {
    const descriptor = computeBenefitEchoDescriptor(
      benefit('product_discount', 'line', { discountType: 'percentage', value: '15', selector: 'nth', nthPosition: 3 }),
    )
    expect(descriptor.scope).toEqual({ kind: 'nth', position: 3, noun: 'line' })
  })

  it('reads an uncapped benefit as "each" scope', () => {
    const descriptor = computeBenefitEchoDescriptor(benefit('product_discount', 'unit', { discountType: 'percentage', value: '15' }))
    expect(descriptor.scope).toEqual({ kind: 'each', noun: 'piece' })
  })

  it('reads free_product as a quantity, not a discount', () => {
    const descriptor = computeBenefitEchoDescriptor(benefit('free_product', 'order', { quantity: 2 }))
    expect(descriptor).toMatchObject({ kind: 'freeProduct', quantity: 2 })
  })

  it('reads tiered_discount from its highest tier, flagged "up to"', () => {
    const descriptor = computeBenefitEchoDescriptor(
      benefit('tiered_discount', 'order', {
        tiers: [
          { threshold: '0', discountType: 'percentage', value: '5' },
          { threshold: '100', discountType: 'percentage', value: '15' },
        ],
      }),
    )
    expect(descriptor).toMatchObject({ kind: 'discount', discountType: 'percentage', value: '15', upTo: true })
  })
})

describe('renderBenefitEcho', () => {
  it('renders the worked example from the spec', () => {
    const line = renderBenefitEcho(
      benefit('buy_x_get_y', 'unit', { discountType: 'percentage', value: '20', maxQuantity: 5, selector: 'cart_order', maxDiscount: '50' }),
      t,
    )
    expect(line).toBe('20% off — the first 5 pieces across the cart, max 50')
  })

  it('renders a whole-order fixed-amount discount with no cap suffix', () => {
    const line = renderBenefitEcho(benefit('cart_discount', 'order', { discountType: 'fixed', value: '10' }), t)
    expect(line).toBe('10 off — the whole order')
  })

  it('renders a quantity-step block suffix for a unit-scoped cap', () => {
    const line = renderBenefitEcho(
      benefit('product_discount', 'unit', { discountType: 'percentage', value: '10', maxQuantity: 6, quantityStep: 3, selector: 'cheapest' }),
      t,
    )
    expect(line).toBe('10% off — the 6 cheapest pieces, in blocks of 3')
  })
})
