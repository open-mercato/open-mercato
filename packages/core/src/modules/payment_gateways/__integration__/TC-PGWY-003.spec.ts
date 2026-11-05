import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createPaymentSession, capturePayment, getTransactionStatus } from './helpers/fixtures'

/**
 * TC-PGWY-003: Capture authorized payment
 */
test.describe('TC-PGWY-003: Capture authorized payment', () => {
  test('should capture a previously authorized payment', async ({ request }) => {
    const token = await getAuthToken(request)

    const session = await createPaymentSession(request, token, {
      providerKey: 'mock',
      amount: 75.00,
      currencyCode: 'USD',
      captureMethod: 'manual',
    })
    expect(session.status).toBe('authorized')

    const capture = await capturePayment(request, token, session.transactionId)
    expect(capture.status).toBe('captured')
    expect(capture.capturedAmount).toBe(75.00)

    const status = await getTransactionStatus(request, token, session.transactionId)
    expect(status.status).toBe('captured')
  })
})
