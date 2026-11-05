import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createPaymentSession, cancelPayment, getTransactionStatus } from './helpers/fixtures'

/**
 * TC-PGWY-005: Cancel/void payment
 */
test.describe('TC-PGWY-005: Cancel/void payment', () => {
  test('should cancel an authorized payment', async ({ request }) => {
    const token = await getAuthToken(request)

    const session = await createPaymentSession(request, token, {
      providerKey: 'mock',
      amount: 30.00,
      currencyCode: 'USD',
      captureMethod: 'manual',
    })
    expect(session.status).toBe('authorized')

    const cancel = await cancelPayment(request, token, session.transactionId)
    expect(cancel.status).toBe('cancelled')

    const status = await getTransactionStatus(request, token, session.transactionId)
    expect(status.status).toBe('cancelled')
  })
})
