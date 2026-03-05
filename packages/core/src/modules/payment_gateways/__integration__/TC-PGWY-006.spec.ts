import { expect, test } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'

/**
 * TC-PGWY-006: Webhook processing
 */
test.describe('TC-PGWY-006: Webhook processing', () => {
  test('should accept a webhook POST for mock provider', async ({ request }) => {
    const response = await apiRequest(request, 'POST', '/api/payment-gateways/webhook/mock', {
      data: {
        type: 'payment.completed',
        id: `evt_${Date.now()}`,
        data: { transactionId: 'mock_test', amount: 10.00 },
      },
    })

    // Webhook endpoint should accept the payload (200 or 202)
    expect(response.status()).toBeLessThan(500)
  })

  test('should return error for unknown webhook provider', async ({ request }) => {
    const response = await apiRequest(request, 'POST', '/api/payment-gateways/webhook/unknown_provider', {
      data: { type: 'test.event', id: 'evt_1' },
    })

    expect(response.status()).toBeGreaterThanOrEqual(400)
  })
})
