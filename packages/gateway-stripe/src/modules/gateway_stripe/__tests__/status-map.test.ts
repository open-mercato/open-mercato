import { describe, expect, it } from '@jest/globals'
import {
  mapStripeAdapterStatus,
  mapStripeStatus,
  mapWebhookEventToStatus,
  resolveStripeWebhookStatus,
} from '../lib/status-map'
import type { WebhookEvent } from '@open-mercato/shared/modules/payment_gateways/types'
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

  it('stays unknown when a partial capture\'s amounts fit neither reading', () => {
    const smallCapture = { id: 'ch_1', amount: 1000, amount_captured: 300, captured: true, refunded: false }
    expect(resolveStripeWebhookStatus('charge.refunded', { ...smallCapture, amount_refunded: 500 }, '2025-03-31.basil')).toBe('unknown')
    expect(resolveStripeWebhookStatus('charge.refunded', { ...smallCapture, amount_refunded: 500 }, '2025-02-24.acacia')).toBe('unknown')
  })

  describe('a charge of 1000 partially captured at 600', () => {
    const partiallyCaptured = { id: 'ch_1', object: 'charge', amount: 1000, amount_captured: 600, captured: true, status: 'succeeded' }

    it.each([
      ['2023-10-16', 400, false, 'unknown'],
      ['2025-02-24.acacia', 400, false, 'unknown'],
      ['2025-02-24.acacia', 700, false, 'partially_refunded'],
      ['2025-02-24.acacia', 1000, true, 'refunded'],
      ['2025-03-31.basil', 300, false, 'partially_refunded'],
      ['2025-03-31.basil', 400, false, 'partially_refunded'],
      ['2025-03-31.basil', 600, true, 'refunded'],
      ['2025-03-31.basil', 600, false, 'refunded'],
      ['2026-09-30.clover', 300, false, 'partially_refunded'],
      ['2025-03-31.basil', 700, false, 'partially_refunded'],
      ['2025-03-31.basil', 1000, false, 'refunded'],
      ['2025-02-24.acacia', 300, false, 'partially_refunded'],
    ])('API version %s, amount_refunded %d (refunded: %s) resolves to %s', (apiVersion, amountRefunded, refunded, expected) => {
      expect(resolveStripeWebhookStatus(
        'charge.refunded',
        { ...partiallyCaptured, amount_refunded: amountRefunded, refunded },
        apiVersion,
      )).toBe(expected)
    })

    it.each([
      [300, 'partially_refunded'],
      [400, 'unknown'],
      [600, 'unknown'],
      [700, 'partially_refunded'],
      [1000, 'refunded'],
    ])('without an API version, amount_refunded %d resolves to %s', (amountRefunded, expected) => {
      expect(resolveStripeWebhookStatus(
        'charge.refunded',
        { ...partiallyCaptured, amount_refunded: amountRefunded, refunded: false },
      )).toBe(expected)
      expect(resolveStripeWebhookStatus(
        'charge.refunded',
        { ...partiallyCaptured, amount_refunded: amountRefunded, refunded: false },
        'not-a-version',
      )).toBe(expected)
    })
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

function stripeEvent(eventType: string, data: Record<string, unknown>, apiVersion?: string): WebhookEvent {
  return {
    eventType,
    eventId: 'evt_1',
    idempotencyKey: 'evt_1',
    timestamp: new Date('2026-01-01T00:00:00.000Z'),
    data,
    ...(apiVersion ? { apiVersion } : {}),
  }
}

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
    expect(adapter.mapStatus('succeeded', 'charge.refunded', stripeEvent('charge.refunded', { ...charge, amount_refunded: 400, refunded: false }))).toBe('partially_refunded')
    expect(adapter.mapStatus('succeeded', 'charge.refunded', stripeEvent('charge.refunded', { ...charge, amount_refunded: 1000, refunded: true }))).toBe('refunded')
  })

  it('reads a partial capture with the API version the event was rendered with', () => {
    const charge = { id: 'ch_1', amount: 1000, amount_captured: 600, captured: true, refunded: false, status: 'succeeded' }
    expect(adapter.mapStatus('succeeded', 'charge.refunded', stripeEvent('charge.refunded', { ...charge, amount_refunded: 300 }, '2025-03-31.basil'))).toBe('partially_refunded')
    expect(adapter.mapStatus('succeeded', 'charge.refunded', stripeEvent('charge.refunded', { ...charge, amount_refunded: 400 }, '2025-03-31.basil'))).toBe('partially_refunded')
    expect(adapter.mapStatus('succeeded', 'charge.refunded', stripeEvent('charge.refunded', { ...charge, amount_refunded: 400 }, '2025-02-24.acacia'))).toBe('unknown')
  })

  it('does not derive a status from a charge, refund or dispute payload', () => {
    expect(adapter.mapStatus('succeeded', 'charge.succeeded', stripeEvent('charge.succeeded', { id: 'ch_1', status: 'succeeded', captured: false }))).toBe('unknown')
    expect(adapter.mapStatus('succeeded', 'charge.refund.updated', stripeEvent('charge.refund.updated', { id: 're_1', status: 'succeeded', amount: 400 }))).toBe('unknown')
    expect(adapter.mapStatus('needs_response', 'charge.dispute.created', stripeEvent('charge.dispute.created', { id: 'dp_1', status: 'needs_response' }))).toBe('unknown')
    expect(adapter.mapStatus('lost', 'charge.dispute.closed', stripeEvent('charge.dispute.closed', { id: 'dp_1', status: 'lost' }))).toBe('unknown')
  })

  it('maps PaymentIntent events the same way with or without the payload', () => {
    expect(adapter.mapStatus('succeeded', 'payment_intent.succeeded', stripeEvent('payment_intent.succeeded', { id: 'pi_1', status: 'succeeded' }))).toBe('captured')
    expect(adapter.mapStatus('requires_capture', 'payment_intent.amount_capturable_updated', stripeEvent('payment_intent.amount_capturable_updated', { id: 'pi_1', status: 'requires_capture' }))).toBe('authorized')
  })
})

describe('mapStripeAdapterStatus', () => {
  it('treats an empty event payload as a payload', () => {
    expect(mapStripeAdapterStatus('', 'charge.refunded', stripeEvent('charge.refunded', {}))).toBe('unknown')
    expect(mapStripeAdapterStatus('', 'payment_intent.succeeded', stripeEvent('payment_intent.succeeded', {}))).toBe('captured')
  })
})
