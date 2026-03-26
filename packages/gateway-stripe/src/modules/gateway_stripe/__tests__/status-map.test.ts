import { describe, expect, it } from '@jest/globals'
import { mapStripeStatus, mapWebhookEventToStatus } from '../lib/status-map'

describe('gateway_stripe status mapping', () => {
  it('maps Stripe API statuses to unified statuses', () => {
    expect(mapStripeStatus('requires_capture')).toBe('authorized')
    expect(mapStripeStatus('succeeded')).toBe('captured')
    expect(mapStripeStatus('canceled')).toBe('cancelled')
    expect(mapStripeStatus('non-existing-status')).toBe('unknown')
  })

  it('maps webhook event types to unified statuses', () => {
    expect(mapWebhookEventToStatus('payment_intent.succeeded')).toBe('captured')
    expect(mapWebhookEventToStatus('payment_intent.payment_failed')).toBe('failed')
    expect(mapWebhookEventToStatus('charge.refunded')).toBe('refunded')
    expect(mapWebhookEventToStatus('random.event')).toBeUndefined()
  })
})
