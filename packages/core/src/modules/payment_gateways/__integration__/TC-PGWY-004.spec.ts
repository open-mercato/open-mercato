import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createPaymentSession, capturePayment, refundPayment, getTransactionStatus } from './helpers/fixtures'

/**
 * TC-PGWY-004: Refund captured payment
 */
test.describe('TC-PGWY-004: Refund captured payment', () => {
  test('should refund a captured payment', async ({ request }) => {
    const token = await getAuthToken(request)

    const session = await createPaymentSession(request, token, {
      providerKey: 'mock',
      amount: 50.00,
      currencyCode: 'USD',
      captureMethod: 'manual',
    })
    expect(session.status).toBe('authorized')

    await capturePayment(request, token, session.transactionId)

    const refund = await refundPayment(request, token, session.transactionId)
    expect(refund.status).toBe('refunded')
    expect(refund.refundedAmount).toBe(50.00)
    expect(refund.refundId).toBeTruthy()

    const status = await getTransactionStatus(request, token, session.transactionId)
    expect(status.status).toBe('refunded')
  })
})
