import type { CreateSessionInput, GatewayAdapter } from '@open-mercato/shared/modules/payment_gateways/types'
import { resolveStripeClient } from '../lib/client'
import { stripeAdapterV20231016 } from '../lib/adapters/v2023-10-16'
import { stripeAdapterV20241218 } from '../lib/adapters/v2024-12-18'
import { stripeAdapterV20250224Acacia } from '../lib/adapters/v2025-02-24.acacia'

jest.mock('../lib/client', () => ({
  resolveStripeClient: jest.fn(),
}))

const adapters: Array<[string, GatewayAdapter]> = [
  ['2023-10-16', stripeAdapterV20231016],
  ['2024-12-18', stripeAdapterV20241218],
  ['2025-02-24.acacia', stripeAdapterV20250224Acacia],
]

describe.each(adapters)('Stripe adapter %s session idempotency', (_version, adapter) => {
  it('passes the stable operation key to Stripe PaymentIntent creation', async () => {
    const create = jest.fn(async () => ({
      id: 'pi_123',
      client_secret: 'secret_123',
      status: 'requires_payment_method',
    }))
    ;(resolveStripeClient as jest.Mock).mockReturnValue({ paymentIntents: { create } })
    const input = {
      paymentId: '11111111-1111-4111-8111-111111111111',
      tenantId: '22222222-2222-4222-8222-222222222222',
      organizationId: '33333333-3333-4333-8333-333333333333',
      amount: 25,
      currencyCode: 'USD',
      credentials: { secretKey: 'sk_test', publishableKey: 'pk_test' },
      idempotencyKey: 'om-payment-session:stable-operation-key',
    } as CreateSessionInput & { idempotencyKey: string }

    await adapter.createSession(input)

    expect(create).toHaveBeenCalledWith(
      expect.any(Object),
      { idempotencyKey: 'om-payment-session:stable-operation-key' },
    )
  })
})
