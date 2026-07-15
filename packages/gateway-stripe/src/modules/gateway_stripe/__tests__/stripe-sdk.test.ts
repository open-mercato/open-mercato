const mockRetrieveCurrent = jest.fn()
const mockConstructEvent = jest.fn()
const mockStripeConstructor = jest.fn().mockImplementation(() => ({
  accounts: { retrieveCurrent: mockRetrieveCurrent },
  webhooks: { constructEvent: mockConstructEvent },
}))

jest.mock('stripe', () => ({
  __esModule: true,
  default: mockStripeConstructor,
}))

import { resolveStripeClient } from '../lib/client'
import { stripeHealthCheck } from '../lib/health'
import { verifyStripeWebhook } from '../lib/webhook-handler'

describe('gateway-stripe server SDK behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockStripeConstructor.mockImplementation(() => ({
      accounts: { retrieveCurrent: mockRetrieveCurrent },
      webhooks: { constructEvent: mockConstructEvent },
    }))
  })

  it('rejects missing credentials before constructing a Stripe client', async () => {
    await expect(resolveStripeClient({}, '2025-02-24.acacia')).rejects.toThrow(
      'Stripe secret key is required',
    )
    expect(mockStripeConstructor).not.toHaveBeenCalled()
  })

  it('preserves the configured API version, retry count, and timeout', async () => {
    await resolveStripeClient({ secretKey: 'sk_test_123' }, '2025-02-24.acacia')

    expect(mockStripeConstructor).toHaveBeenCalledWith('sk_test_123', {
      apiVersion: '2025-02-24.acacia',
      maxNetworkRetries: 2,
      timeout: 10_000,
    })
  })

  it('returns the existing healthy account result shape', async () => {
    mockRetrieveCurrent.mockResolvedValue({
      id: 'acct_123',
      business_type: 'company',
      charges_enabled: true,
      payouts_enabled: false,
      country: 'PL',
    })

    const result = await stripeHealthCheck.check({ secretKey: 'sk_test_123' })

    expect(result).toEqual({
      status: 'healthy',
      message: 'Connected to Stripe account acct_123',
      details: {
        accountId: 'acct_123',
        businessType: 'company',
        chargesEnabled: true,
        payoutsEnabled: false,
        country: 'PL',
      },
      checkedAt: expect.any(Date),
    })
  })

  it('keeps health-check SDK failures in the unhealthy result', async () => {
    mockRetrieveCurrent.mockRejectedValue(new Error('connection refused'))

    await expect(stripeHealthCheck.check({ secretKey: 'sk_test_123' })).resolves.toEqual({
      status: 'unhealthy',
      message: 'Stripe connection failed: connection refused',
      details: { error: 'connection refused' },
      checkedAt: expect.any(Date),
    })
  })

  it('constructs and maps a verified webhook event unchanged', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_123',
      type: 'payment_intent.succeeded',
      created: 1_735_689_600,
      data: { object: { id: 'pi_123', status: 'succeeded' } },
    })

    const result = await verifyStripeWebhook({
      rawBody: Buffer.from('{"id":"evt_123"}'),
      headers: { 'stripe-signature': 'sig_123' },
      credentials: {
        secretKey: 'sk_test_123',
        webhookSecret: 'whsec_123',
      },
    })

    expect(mockConstructEvent).toHaveBeenCalledWith(
      '{"id":"evt_123"}',
      'sig_123',
      'whsec_123',
    )
    expect(result).toEqual({
      eventType: 'payment_intent.succeeded',
      eventId: 'evt_123',
      data: { id: 'pi_123', status: 'succeeded' },
      idempotencyKey: 'evt_123',
      timestamp: new Date(1_735_689_600_000),
    })
  })

  it('preserves client construction before the missing-signature check', async () => {
    await expect(verifyStripeWebhook({
      rawBody: '{}',
      headers: {},
      credentials: {
        secretKey: 'sk_test_123',
        webhookSecret: 'whsec_123',
      },
    })).rejects.toThrow('Missing stripe-signature header')

    expect(mockStripeConstructor).toHaveBeenCalledWith('sk_test_123')
    expect(mockConstructEvent).not.toHaveBeenCalled()
  })
})
