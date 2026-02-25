import { describe, expect, it } from '@jest/globals'
import { resolveCheckoutTransitionTarget } from '../storefrontCheckoutWorkflow'

describe('storefrontCheckoutWorkflow', () => {
  describe('resolveCheckoutTransitionTarget', () => {
    it('maps set_customer from cart to customer', () => {
      expect(resolveCheckoutTransitionTarget('set_customer', 'cart')).toBe('customer')
    })

    it('maps set_shipping from customer to shipping', () => {
      expect(resolveCheckoutTransitionTarget('set_shipping', 'customer')).toBe('shipping')
    })

    it('maps review from shipping to review', () => {
      expect(resolveCheckoutTransitionTarget('review', 'shipping')).toBe('review')
    })

    it('maps place_order from review to placing_order', () => {
      expect(resolveCheckoutTransitionTarget('place_order', 'review')).toBe('placing_order')
    })

    it('maps cancel from active step to cancelled', () => {
      expect(resolveCheckoutTransitionTarget('cancel', 'customer')).toBe('cancelled')
    })

    it('returns null for disallowed transition', () => {
      expect(resolveCheckoutTransitionTarget('place_order', 'customer')).toBeNull()
    })
  })
})
