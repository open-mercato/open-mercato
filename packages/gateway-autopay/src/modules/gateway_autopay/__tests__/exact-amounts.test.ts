import { autopayAdapterV1 } from '../lib/adapters/v1'
import { interpretAutopayTransactionStatus, type AutopayTransactionRecord } from '../lib/status-map'

const credentials = {
  serviceId: '2',
  sharedKey: '2test2',
  gatewayUrl: 'https://testpay.autopay.eu/sciezka',
}

function tx(overrides: Partial<AutopayTransactionRecord>): AutopayTransactionRecord {
  return {
    orderID: 'order-1',
    remoteID: 'remote-1',
    amount: '0.10',
    currency: 'PLN',
    paymentDate: '20010101111111',
    paymentStatus: 'SUCCESS',
    ...overrides,
  }
}

describe('Autopay exact amounts', () => {
  it('sums overpaid transactions exactly', () => {
    const result = interpretAutopayTransactionStatus([
      tx({ remoteID: 'r1', amount: '0.10' }),
      tx({ remoteID: 'r2', amount: '0.20' }),
    ])
    expect(result.amountReceivedExact).toBe('0.3')
    expect(result.amountReceived).toBe(0.3)
    expect(result.amountExact).toBe('0.1')
  })

  it('sends the exact amount, padded to two decimals', async () => {
    const result = await autopayAdapterV1.createSession({
      paymentId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      tenantId: 't1',
      organizationId: 'o1',
      amount: 90071992547409.9,
      amountExact: '90071992547409.91',
      currencyCode: 'PLN',
      credentials,
      metadata: { customerEmail: 'buyer@example.com' },
      successUrl: 'https://shop.example.com/pay/s/success/abc',
      cancelUrl: 'https://shop.example.com/pay/s/cancel/abc',
    })
    const providerData = result.providerData as { formPost: { fields: Record<string, string> } }
    expect(providerData.formPost.fields.Amount).toBe('90071992547409.91')
  })
})
