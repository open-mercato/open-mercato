import { expect, test } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createPaymentSession, getTransactionStatus } from './helpers/fixtures'

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'

/**
 * TC-PGWY-011: Webhook malformed payload
 *
 * Sends webhooks with invalid or malformed payloads to the mock provider
 * endpoint. Verifies the system returns appropriate error responses and
 * does not produce side effects on existing transactions.
 */
test.describe('TC-PGWY-011: Webhook malformed payload', () => {
  test('should reject a webhook with completely invalid JSON body', async ({ request }) => {
    const token = await getAuthToken(request)

    const response = await request.fetch(`${BASE_URL}/api/payment_gateways/webhook/mock`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: Buffer.from('this is not json {{{'),
    })

    // Mock adapter's verifyWebhook calls JSON.parse, which throws on invalid JSON.
    // The webhook endpoint catches the error and returns 401.
    expect(response.status()).toBeGreaterThanOrEqual(400)
    expect(response.status()).toBeLessThan(500)
  })

  test('should reject a webhook with empty body', async ({ request }) => {
    const token = await getAuthToken(request)

    const response = await request.fetch(`${BASE_URL}/api/payment_gateways/webhook/mock`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: Buffer.alloc(0),
    })

    // Empty body causes JSON.parse to throw in verifyWebhook
    expect(response.status()).toBeGreaterThanOrEqual(400)
    expect(response.status()).toBeLessThan(500)
  })

  test('should not affect existing transactions when webhook has non-matching session id', async ({ request }) => {
    const token = await getAuthToken(request)

    const session = await createPaymentSession(request, token, {
      providerKey: 'mock',
      amount: 42.00,
      currencyCode: 'USD',
      captureMethod: 'manual',
    })
    expect(session.status).toBe('authorized')

    // Send a webhook referencing a non-existent session id
    const response = await apiRequest(request, 'POST', '/api/payment_gateways/webhook/mock', {
      token,
      data: {
        type: 'payment.captured',
        id: 'non_existent_session_id_12345',
        data: { id: 'non_existent_session_id_12345', status: 'captured', amount: 42.00 },
      },
    })

    // Webhook endpoint accepts the call (202) but worker will find no matching transaction
    expect(response.status()).toBe(202)

    // Wait briefly to let async processing complete
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Verify the existing transaction was not affected
    const status = await getTransactionStatus(request, token, session.transactionId)
    expect(status.status).toBe('authorized')
  })

  test('should handle webhook with missing type and id fields without crashing', async ({ request }) => {
    const token = await getAuthToken(request)

    // Valid JSON but missing the standard type/id fields
    const response = await apiRequest(request, 'POST', '/api/payment_gateways/webhook/mock', {
      token,
      data: { unexpected: 'payload', nested: { value: 123 } },
    })

    // The mock verifyWebhook defaults type to 'mock.event' and id to random UUID.
    // The endpoint should accept it (202) — worker will skip since no transaction matches.
    expect(response.status()).toBe(202)
  })
})
