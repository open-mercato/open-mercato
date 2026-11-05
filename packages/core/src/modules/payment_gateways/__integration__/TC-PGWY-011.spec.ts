import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createPaymentSession, getTransactionStatus, postMockWebhook } from './helpers/fixtures'

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

    // Unsigned body fails HMAC verification in the mock adapter and the endpoint
    // returns 401. Invalid JSON still never reaches JSON.parse.
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

    // Missing signature header — request is rejected before any parsing attempt.
    expect(response.status()).toBeGreaterThanOrEqual(400)
    expect(response.status()).toBeLessThan(500)
  })

  test('should fail closed for a signed webhook that references a non-existent session id', async ({ request }) => {
    const token = await getAuthToken(request)

    const session = await createPaymentSession(request, token, {
      providerKey: 'mock',
      amount: 42.00,
      currencyCode: 'USD',
      captureMethod: 'manual',
    })
    expect(session.status).toBe('authorized')

    // Signed webhook referencing a session id that never existed. The webhook route
    // cannot locate a candidate GatewayTransaction whose per-tenant credentials can
    // verify the signature, so it MUST fail closed with 401 — never 202.
    const response = await postMockWebhook(request, {
      token,
      payload: {
        type: 'payment.captured',
        id: 'non_existent_session_id_12345',
        data: { id: 'non_existent_session_id_12345', status: 'captured', amount: 42.00 },
      },
    })

    expect(response.status()).toBe(401)

    // Wait briefly to let any async processing settle
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Verify the existing transaction was not affected
    const status = await getTransactionStatus(request, token, session.transactionId)
    expect(status.status).toBe('authorized')
  })

  test('should fail closed for a signed webhook with missing type and id fields', async ({ request }) => {
    const token = await getAuthToken(request)

    // Valid JSON + valid HMAC signature, but no recognizable session id. The webhook
    // route cannot find a candidate transaction, so it rejects with 401 instead of
    // silently accepting the event.
    const response = await postMockWebhook(request, {
      token,
      payload: { unexpected: 'payload', nested: { value: 123 } },
    })

    expect(response.status()).toBe(401)
  })
})
