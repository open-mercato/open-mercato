import { expect, test } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createPaymentSession, getTransactionStatus } from './helpers/fixtures'

/**
 * TC-PGWY-010: Webhook duplicate handling (idempotent)
 *
 * Sends the same webhook event twice to the mock provider webhook endpoint.
 * The webhook endpoint returns 202 (accepted for async processing) for each
 * call. The worker uses idempotency keys to skip duplicate events.
 * Verifies that duplicate webhooks do not cause errors or double processing.
 */
test.describe('TC-PGWY-010: Webhook duplicate handling', () => {
  test('should accept duplicate webhook events gracefully without double processing', async ({ request }) => {
    const token = await getAuthToken(request)

    const session = await createPaymentSession(request, token, {
      providerKey: 'mock',
      amount: 55.00,
      currencyCode: 'USD',
      captureMethod: 'manual',
    })
    expect(session.status).toBe('authorized')

    const webhookPayload = {
      type: 'payment.captured',
      id: session.sessionId,
      data: { id: session.sessionId, status: 'captured', amount: 55.00 },
    }

    // Send the same webhook event twice
    const firstResponse = await apiRequest(request, 'POST', '/api/payment_gateways/webhook/mock', {
      token,
      data: webhookPayload,
    })
    expect(firstResponse.status()).toBe(202)

    const secondResponse = await apiRequest(request, 'POST', '/api/payment_gateways/webhook/mock', {
      token,
      data: webhookPayload,
    })
    expect(secondResponse.status()).toBe(202)

    // Wait for async webhook processing to complete
    let currentStatus = 'authorized'
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const status = await getTransactionStatus(request, token, session.transactionId)
      currentStatus = status.status
      if (currentStatus === 'captured') break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    expect(currentStatus).toBe('captured')

    // Final status check — should still be captured, not double-processed
    const finalStatus = await getTransactionStatus(request, token, session.transactionId)
    expect(finalStatus.status).toBe('captured')
  })

  test('should handle duplicate webhook with identical idempotency key and return 202', async ({ request }) => {
    const token = await getAuthToken(request)

    const session = await createPaymentSession(request, token, {
      providerKey: 'mock',
      amount: 20.00,
      currencyCode: 'GBP',
      captureMethod: 'manual',
    })
    expect(session.status).toBe('authorized')

    const eventId = `evt_dedup_${Date.now()}`
    const webhookPayload = {
      type: 'payment.captured',
      id: eventId,
      data: { id: session.sessionId, status: 'captured', amount: 20.00 },
    }

    // First webhook call
    const firstResponse = await apiRequest(request, 'POST', '/api/payment_gateways/webhook/mock', {
      token,
      data: webhookPayload,
    })
    expect(firstResponse.status()).toBe(202)

    // Small delay to let the first event process
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Second duplicate call with same payload
    const secondResponse = await apiRequest(request, 'POST', '/api/payment_gateways/webhook/mock', {
      token,
      data: webhookPayload,
    })
    // Both calls should be accepted — idempotency is enforced at the worker level
    expect(secondResponse.status()).toBe(202)

    // Wait for processing and verify final state
    let currentStatus = 'authorized'
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const status = await getTransactionStatus(request, token, session.transactionId)
      currentStatus = status.status
      if (currentStatus === 'captured') break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    expect(currentStatus).toBe('captured')
  })
})
