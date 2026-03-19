import { readStripeSessionIdHint } from '../lib/webhook-handler'

describe('stripe webhook helper', () => {
  it('extracts the payment intent id from the raw Stripe payload', () => {
    expect(readStripeSessionIdHint({
      data: {
        object: {
          payment_intent: 'pi_123',
        },
      },
    })).toBe('pi_123')
  })
})
