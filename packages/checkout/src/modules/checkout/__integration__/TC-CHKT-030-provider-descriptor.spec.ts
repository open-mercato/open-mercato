import { expect, test } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

test.describe('TC-CHKT-030 (descriptor): Payment-gateway descriptor API exposes safe settings/currency metadata without credentials', () => {
  test('returns provider metadata needed by checkout forms without leaking credential material', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(request, 'GET', '/api/payment_gateways/providers/mock_usd', { token })
    expect(response.ok()).toBeTruthy()

    const descriptor = await readJsonSafe<Record<string, unknown>>(response)
    expect(descriptor).toMatchObject({
      providerKey: 'mock_usd',
      label: 'Mock Gateway (USD only)',
      sessionConfig: expect.objectContaining({
        supportedCurrencies: ['USD'],
      }),
    })
    expect(descriptor).not.toHaveProperty('credentials')
    expect(JSON.stringify(descriptor)).not.toContain('secret')
  })
})
