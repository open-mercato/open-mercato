import {
  classifyStripeEvent,
  readStripeSessionIdHint,
  readStripeSubscriptionRef,
} from '../lib/webhook-handler'

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

  describe('classifyStripeEvent', () => {
    it('classifies customer.subscription.* as subscription', () => {
      expect(classifyStripeEvent({ type: 'customer.subscription.created' })).toBe('subscription')
      expect(classifyStripeEvent({ type: 'customer.subscription.updated' })).toBe('subscription')
      expect(classifyStripeEvent({ type: 'customer.subscription.deleted' })).toBe('subscription')
      expect(classifyStripeEvent({ type: 'customer.subscription.trial_will_end' })).toBe('subscription')
    })

    it('classifies invoice.* events as subscription', () => {
      expect(classifyStripeEvent({ type: 'invoice.paid' })).toBe('subscription')
      expect(classifyStripeEvent({ type: 'invoice.payment_failed' })).toBe('subscription')
    })

    it('classifies subscription-linked charge.refunded as subscription', () => {
      expect(classifyStripeEvent({
        type: 'charge.refunded',
        data: { object: { invoice: 'in_123' } },
      })).toBe('subscription')
    })

    it('classifies non-subscription charge.refunded as transaction', () => {
      expect(classifyStripeEvent({
        type: 'charge.refunded',
        data: { object: { invoice: null } },
      })).toBe('transaction')
    })

    it('classifies payment_intent.* and checkout.session.* as transaction', () => {
      expect(classifyStripeEvent({ type: 'payment_intent.succeeded' })).toBe('transaction')
      expect(classifyStripeEvent({ type: 'checkout.session.completed' })).toBe('transaction')
    })

    it('classifies unknown event types as unknown', () => {
      expect(classifyStripeEvent({ type: 'mystery.event' })).toBe('unknown')
      expect(classifyStripeEvent(null)).toBe('unknown')
    })
  })

  describe('readStripeSubscriptionRef', () => {
    it('reads ids from customer.subscription.* events', () => {
      expect(readStripeSubscriptionRef({
        type: 'customer.subscription.created',
        data: { object: { id: 'sub_1', customer: 'cus_1' } },
      })).toEqual({
        providerSubscriptionId: 'sub_1',
        providerCustomerId: 'cus_1',
      })
    })

    it('reads ids from invoice.* events', () => {
      expect(readStripeSubscriptionRef({
        type: 'invoice.payment_failed',
        data: { object: { id: 'in_2', subscription: 'sub_2', customer: 'cus_2' } },
      })).toEqual({
        providerSubscriptionId: 'sub_2',
        providerCustomerId: 'cus_2',
        providerInvoiceId: 'in_2',
      })
    })

    it('returns null for non-subscription charge.refunded', () => {
      expect(readStripeSubscriptionRef({
        type: 'charge.refunded',
        data: { object: { invoice: null, id: 'ch_3', customer: 'cus_3' } },
      })).toBeNull()
    })
  })
})
