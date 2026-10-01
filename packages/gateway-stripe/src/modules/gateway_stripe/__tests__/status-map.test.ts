import { describe, expect, it } from '@jest/globals'
import {
  mapStripeAdapterStatus,
  mapStripeStatus,
  mapWebhookEventToStatus,
  resolveStripeWebhookStatus,
} from '../lib/status-map'
import { stripeAdapterV20231016 } from '../lib/adapters/v2023-10-16'
import { stripeAdapterV20241218 } from '../lib/adapters/v2024-12-18'
import { stripeAdapterV20250224Acacia } from '../lib/adapters/v2025-02-24.acacia'

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

describe('resolveStripeWebhookStatus', () => {
  it('keeps the PaymentIntent event mapping', () => {
    expect(resolveStripeWebhookStatus('payment_intent.succeeded', { id: 'pi_1', status: 'succeeded' })).toBe('captured')
    expect(resolveStripeWebhookStatus('payment_intent.payment_failed', { id: 'pi_1', status: 'requires_payment_method' })).toBe('failed')
    expect(resolveStripeWebhookStatus('payment_intent.canceled', { id: 'pi_1', status: 'canceled' })).toBe('cancelled')
    expect(resolveStripeWebhookStatus('payment_intent.requires_action', { id: 'pi_1', status: 'requires_action' })).toBe('pending')
  })

  it('falls back to the PaymentIntent status for unmapped PaymentIntent events', () => {
    expect(resolveStripeWebhookStatus('payment_intent.amount_capturable_updated', { id: 'pi_1', status: 'requires_capture' })).toBe('authorized')
    expect(resolveStripeWebhookStatus('payment_intent.created', { id: 'pi_1', status: 'requires_payment_method' })).toBe('pending')
    expect(resolveStripeWebhookStatus('payment_intent.created', { id: 'pi_1' })).toBe('unknown')
  })

  it('resolves a fully refunded charge to refunded', () => {
    expect(resolveStripeWebhookStatus('charge.refunded', {
      id: 'ch_1', amount: 1000, amount_captured: 1000, amount_refunded: 1000, refunded: true, status: 'succeeded',
    })).toBe('refunded')
    expect(resolveStripeWebhookStatus('charge.refunded', { id: 'ch_1', amount: 1000, amount_refunded: 1000 })).toBe('refunded')
    expect(resolveStripeWebhookStatus('charge.refunded', { id: 'ch_1', refunded: true })).toBe('refunded')
  })

  it('resolves a partially refunded charge to partially_refunded', () => {
    expect(resolveStripeWebhookStatus('charge.refunded', {
      id: 'ch_1', amount: 1000, amount_captured: 1000, amount_refunded: 400, refunded: false, status: 'succeeded',
    })).toBe('partially_refunded')
    expect(resolveStripeWebhookStatus('charge.refunded', { id: 'ch_1', amount: 1000, amount_refunded: 1 })).toBe('partially_refunded')
  })

  it('stays unknown when the refunded amount does not exceed the uncaptured remainder of a partial capture', () => {
    const partiallyCaptured = { id: 'ch_1', amount: 1000, amount_captured: 600, refunded: false, status: 'succeeded' }
    expect(resolveStripeWebhookStatus('charge.refunded', { ...partiallyCaptured, amount_refunded: 400 })).toBe('unknown')
    expect(resolveStripeWebhookStatus('charge.refunded', { ...partiallyCaptured, amount_refunded: 300 })).toBe('unknown')
  })

  it('resolves refunds of a partially captured charge against the captured amount', () => {
    const partiallyCaptured = { id: 'ch_1', amount: 1000, amount_captured: 600, refunded: false, status: 'succeeded' }
    expect(resolveStripeWebhookStatus('charge.refunded', { ...partiallyCaptured, amount_refunded: 700 })).toBe('partially_refunded')
    expect(resolveStripeWebhookStatus('charge.refunded', { ...partiallyCaptured, amount_refunded: 1000 })).toBe('refunded')
    expect(resolveStripeWebhookStatus('charge.refunded', { ...partiallyCaptured, amount_refunded: 1000, refunded: true })).toBe('refunded')
  })

  it('never guesses a refund when the charge payload does not prove one', () => {
    expect(resolveStripeWebhookStatus('charge.refunded', {})).toBe('unknown')
    expect(resolveStripeWebhookStatus('charge.refunded', { id: 'ch_1', refunded: false })).toBe('unknown')
    expect(resolveStripeWebhookStatus('charge.refunded', { id: 'ch_1', amount: 1000, amount_refunded: 0, refunded: false })).toBe('unknown')
    expect(resolveStripeWebhookStatus('charge.refunded', { id: 'ch_1', amount: '1000', amount_refunded: '1000' })).toBe('unknown')
    expect(resolveStripeWebhookStatus('charge.refunded', { id: 'ch_1', amount: Number.NaN, amount_refunded: 1000 })).toBe('unknown')
    expect(resolveStripeWebhookStatus('charge.refunded', { id: 'ch_1', amount: 0, amount_refunded: 5 })).toBe('unknown')
    expect(resolveStripeWebhookStatus('charge.refunded', { id: 'ch_1', amount: -5, amount_refunded: 3 })).toBe('unknown')
  })

  it('does not treat a released authorization as a refund', () => {
    expect(resolveStripeWebhookStatus('charge.refunded', {
      id: 'ch_1', amount: 1000, amount_captured: 0, amount_refunded: 1000, captured: false, refunded: true, status: 'succeeded',
    })).toBe('unknown')
    expect(resolveStripeWebhookStatus('charge.refunded', { id: 'ch_1', amount_captured: 0, refunded: true })).toBe('unknown')
    expect(resolveStripeWebhookStatus('charge.refunded', { id: 'ch_1', amount: 1000, amount_refunded: 1000, captured: false, refunded: true })).toBe('unknown')
    expect(resolveStripeWebhookStatus('charge.refunded', { id: 'ch_1', amount: 1000, amount_captured: -1, amount_refunded: 1000, refunded: true })).toBe('unknown')
  })

  it('resolves refunds of an over-captured charge against the charge amount', () => {
    expect(resolveStripeWebhookStatus('charge.refunded', { id: 'ch_1', amount: 1000, amount_captured: 1200, amount_refunded: 500, refunded: false })).toBe('partially_refunded')
    expect(resolveStripeWebhookStatus('charge.refunded', { id: 'ch_1', amount: 1000, amount_captured: 1200, amount_refunded: 1000, refunded: false })).toBe('refunded')
  })

  it.each([
    ['charge.refund.updated', { id: 're_1', object: 'refund', amount: 400, status: 'succeeded' }],
    ['charge.refund.updated', { id: 're_1', object: 'refund', amount: 400, status: 'failed' }],
    ['charge.dispute.created', { id: 'dp_1', object: 'dispute', amount: 1000, status: 'needs_response' }],
    ['charge.dispute.closed', { id: 'dp_1', object: 'dispute', amount: 1000, status: 'lost' }],
    ['charge.dispute.closed', { id: 'dp_1', object: 'dispute', amount: 1000, status: 'won' }],
    ['charge.succeeded', { id: 'ch_1', object: 'charge', amount: 1000, captured: false, status: 'succeeded' }],
    ['charge.captured', { id: 'ch_1', object: 'charge', amount: 1000, captured: true, status: 'succeeded' }],
    ['refund.created', { id: 're_1', object: 'refund', amount: 400, status: 'succeeded' }],
    ['checkout.session.completed', { id: 'cs_1', object: 'checkout.session', status: 'complete' }],
  ])('records %s without a status change', (eventType, data) => {
    expect(resolveStripeWebhookStatus(eventType, data)).toBe('unknown')
  })
})

describe.each([
  ['2023-10-16', stripeAdapterV20231016],
  ['2024-12-18', stripeAdapterV20241218],
  ['2025-02-24.acacia', stripeAdapterV20250224Acacia],
])('stripe adapter %s mapStatus', (_version, adapter) => {
  it('maps a provider status without an event', () => {
    expect(adapter.mapStatus('requires_capture')).toBe('authorized')
    expect(adapter.mapStatus('succeeded')).toBe('captured')
  })

  it('keeps the event-type table for callers that pass no event payload', () => {
    expect(adapter.mapStatus('', 'payment_intent.succeeded')).toBe('captured')
    expect(adapter.mapStatus('', 'charge.refunded')).toBe('refunded')
    expect(adapter.mapStatus('succeeded', 'random.event')).toBe('captured')
  })

  it('tells a partial refund from a full one when the charge payload is passed', () => {
    const charge = { id: 'ch_1', amount: 1000, amount_captured: 1000, status: 'succeeded' }
    expect(adapter.mapStatus('succeeded', 'charge.refunded', { ...charge, amount_refunded: 400, refunded: false })).toBe('partially_refunded')
    expect(adapter.mapStatus('succeeded', 'charge.refunded', { ...charge, amount_refunded: 1000, refunded: true })).toBe('refunded')
  })

  it('does not derive a status from a charge, refund or dispute payload', () => {
    expect(adapter.mapStatus('succeeded', 'charge.succeeded', { id: 'ch_1', status: 'succeeded', captured: false })).toBe('unknown')
    expect(adapter.mapStatus('succeeded', 'charge.refund.updated', { id: 're_1', status: 'succeeded', amount: 400 })).toBe('unknown')
    expect(adapter.mapStatus('needs_response', 'charge.dispute.created', { id: 'dp_1', status: 'needs_response' })).toBe('unknown')
    expect(adapter.mapStatus('lost', 'charge.dispute.closed', { id: 'dp_1', status: 'lost' })).toBe('unknown')
  })

  it('maps PaymentIntent events the same way with or without the payload', () => {
    expect(adapter.mapStatus('succeeded', 'payment_intent.succeeded', { id: 'pi_1', status: 'succeeded' })).toBe('captured')
    expect(adapter.mapStatus('requires_capture', 'payment_intent.amount_capturable_updated', { id: 'pi_1', status: 'requires_capture' })).toBe('authorized')
  })
})

describe('mapStripeAdapterStatus', () => {
  it('treats an empty event payload as a payload', () => {
    expect(mapStripeAdapterStatus('', 'charge.refunded', {})).toBe('unknown')
    expect(mapStripeAdapterStatus('', 'payment_intent.succeeded', {})).toBe('captured')
  })
})
