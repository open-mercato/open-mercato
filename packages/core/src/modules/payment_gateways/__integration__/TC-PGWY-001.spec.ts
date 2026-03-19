import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createPaymentSession } from './helpers/fixtures'

/**
 * TC-PGWY-001: Create payment session (happy path)
 */
test.describe('TC-PGWY-001: Create payment session', () => {
  test('should create a payment session with mock provider and return authorized status', async ({ request }) => {
    const token = await getAuthToken(request)

    const session = await createPaymentSession(request, token, {
      providerKey: 'mock',
      amount: 49.99,
      currencyCode: 'USD',
      captureMethod: 'manual',
    })

    expect(session.transactionId).toBeTruthy()
    expect(session.sessionId).toBeTruthy()
    expect(session.paymentId).toBeTruthy()
    expect(session.status).toBe('authorized')
    expect(session.clientSecret).toBeTruthy()
  })

  test('should create an auto-capture session with captured status', async ({ request }) => {
    const token = await getAuthToken(request)

    const session = await createPaymentSession(request, token, {
      providerKey: 'mock',
      amount: 25.00,
      currencyCode: 'EUR',
      captureMethod: 'automatic',
    })

    expect(session.transactionId).toBeTruthy()
    expect(session.status).toBe('captured')
  })
})
