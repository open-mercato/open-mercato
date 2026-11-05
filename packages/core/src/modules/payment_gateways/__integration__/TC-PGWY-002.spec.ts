import { expect, test } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'

/**
 * TC-PGWY-002: Unknown provider returns error
 */
test.describe('TC-PGWY-002: Unknown provider returns error', () => {
  test('should return 400 when using a non-existent provider', async ({ request }) => {
    const token = await getAuthToken(request)

    const response = await apiRequest(request, 'POST', '/api/payment_gateways/sessions', {
      token,
      data: {
        providerKey: 'non_existent_provider',
        amount: 10.00,
        currencyCode: 'USD',
        captureMethod: 'manual',
        description: 'QA test unknown provider',
      },
    })

    expect(response.status()).toBeGreaterThanOrEqual(400)
    const body = await response.json()
    expect(body.error).toBeTruthy()
  })
})
