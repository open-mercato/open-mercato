import { expect, test } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createPaymentSession, getTransactionStatus } from './helpers/fixtures'

/**
 * TC-PGWY-006: Webhook processing
 */
test.describe('TC-PGWY-006: Webhook processing', () => {
  test('should accept a webhook POST for mock provider and sync transaction status', async ({ request }) => {
    const token = await getAuthToken(request)
    const session = await createPaymentSession(request, token, {
      providerKey: 'mock',
      amount: 10.00,
      currencyCode: 'USD',
      captureMethod: 'manual',
    })
    expect(session.status).toBe('authorized')

    const response = await apiRequest(request, 'POST', '/api/payment_gateways/webhook/mock', {
      token,
      data: {
        type: 'payment.captured',
        id: session.sessionId,
        data: { id: session.sessionId, status: 'captured', amount: 10.00 },
      },
    })

    expect(response.status()).toBe(202)

    let currentStatus = 'authorized'
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const status = await getTransactionStatus(request, token, session.transactionId)
      currentStatus = status.status
      if (currentStatus === 'captured') break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    expect(currentStatus).toBe('captured')
  })

  test('should return error for unknown webhook provider', async ({ request }) => {
    const token = await getAuthToken(request)

    const response = await apiRequest(request, 'POST', '/api/payment_gateways/webhook/unknown_provider', {
      token,
      data: { type: 'test.event', id: 'evt_1' },
    })

    expect(response.status()).toBe(404)
  })
})
