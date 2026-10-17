import { readStripeSessionIdHint } from '../lib/webhook-handler'

function stripeEvent(object: Record<string, unknown>): Record<string, unknown> {
  return { id: 'evt_1', object: 'event', type: 'test', data: { object } }
}

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

  it('uses the PaymentIntent object id for payment_intent events', () => {
    expect(readStripeSessionIdHint(stripeEvent({
      id: 'pi_123',
      object: 'payment_intent',
      status: 'succeeded',
    }))).toBe('pi_123')
  })

  it.each([
    ['charge', { id: 'ch_1', object: 'charge', payment_intent: 'pi_123', amount: 1000, amount_refunded: 1000 }],
    ['refund', { id: 're_1', object: 'refund', payment_intent: 'pi_123', charge: 'ch_1', amount: 400 }],
    ['dispute', { id: 'dp_1', object: 'dispute', payment_intent: 'pi_123', charge: 'ch_1', amount: 1000 }],
  ])('locates a %s object by the PaymentIntent it references, not by its own id', (_kind, object) => {
    expect(readStripeSessionIdHint(stripeEvent(object))).toBe('pi_123')
  })

  it('falls back to the object id when the object references no PaymentIntent', () => {
    expect(readStripeSessionIdHint(stripeEvent({ id: 'ch_legacy', object: 'charge', payment_intent: null }))).toBe('ch_legacy')
    expect(readStripeSessionIdHint(stripeEvent({ id: 'ch_expanded', object: 'charge', payment_intent: { id: 'pi_123' } }))).toBe('ch_expanded')
  })

  it('returns null without a payload', () => {
    expect(readStripeSessionIdHint(null)).toBeNull()
  })
})
