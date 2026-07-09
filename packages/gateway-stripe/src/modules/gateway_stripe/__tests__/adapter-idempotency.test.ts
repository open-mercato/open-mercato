import { stripeAdapterV20231016 } from '../lib/adapters/v2023-10-16'
import { stripeAdapterV20241218 } from '../lib/adapters/v2024-12-18'
import { stripeAdapterV20250224Acacia } from '../lib/adapters/v2025-02-24.acacia'
import { resolveStripeClient } from '../lib/client'

jest.mock('../lib/client', () => ({
  resolveStripeClient: jest.fn(),
}))

const capture = jest.fn()
const createRefund = jest.fn()
const cancel = jest.fn()
const retrievePaymentIntent = jest.fn()
const retrieveCharge = jest.fn()

const stripe = {
  paymentIntents: {
    capture,
    cancel,
    retrieve: retrievePaymentIntent,
  },
  refunds: { create: createRefund },
  charges: { retrieve: retrieveCharge },
}

const adapters = [
  ['2023-10-16', stripeAdapterV20231016],
  ['2024-12-18', stripeAdapterV20241218],
  ['2025-02-24.acacia', stripeAdapterV20250224Acacia],
] as const

describe('Stripe manual payment operation idempotency', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(resolveStripeClient as jest.Mock).mockReturnValue(stripe)
    capture.mockResolvedValue({ status: 'succeeded', amount_received: 1000, currency: 'usd', latest_charge: 'ch_1' })
    createRefund.mockResolvedValue({ id: 're_1', status: 'succeeded', amount: 1000, currency: 'usd' })
    cancel.mockResolvedValue({ status: 'canceled' })
  })

  it.each(adapters)('%s forwards the core idempotency key to capture', async (_version, adapter) => {
    await adapter.capture({
      sessionId: 'pi_1',
      credentials: { secretKey: 'sk_test' },
      idempotencyKey: 'payment-operation-key',
    })

    expect(capture).toHaveBeenCalledWith(
      'pi_1',
      expect.any(Object),
      { idempotencyKey: 'payment-operation-key' },
    )
  })

  it.each(adapters)('%s forwards the core idempotency key to refund', async (_version, adapter) => {
    await adapter.refund({
      sessionId: 'pi_1',
      credentials: { secretKey: 'sk_test' },
      idempotencyKey: 'payment-operation-key',
    })

    expect(createRefund).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_1' }),
      { idempotencyKey: 'payment-operation-key' },
    )
  })

  it.each(adapters)('%s keeps a successful partial refund non-terminal', async (_version, adapter) => {
    retrievePaymentIntent.mockResolvedValue({ amount_received: 4000, currency: 'usd' })
    createRefund.mockResolvedValue({
      id: 're_partial',
      status: 'succeeded',
      amount: 1000,
      currency: 'usd',
      charge: 'ch_1',
    })
    retrieveCharge.mockResolvedValue({ amount: 4000, amount_refunded: 1000 })

    const result = await adapter.refund({
      sessionId: 'pi_1',
      amount: 10,
      credentials: { secretKey: 'sk_test' },
      idempotencyKey: 'partial-refund-operation',
    })

    expect(result.status).toBe('partially_refunded')
    expect(retrieveCharge).toHaveBeenCalledWith('ch_1')
  })

  it.each(adapters)('%s forwards the core idempotency key to cancel', async (_version, adapter) => {
    await adapter.cancel({
      sessionId: 'pi_1',
      credentials: { secretKey: 'sk_test' },
      idempotencyKey: 'payment-operation-key',
    })

    expect(cancel).toHaveBeenCalledWith(
      'pi_1',
      expect.anything(),
      { idempotencyKey: 'payment-operation-key' },
    )
  })
})
