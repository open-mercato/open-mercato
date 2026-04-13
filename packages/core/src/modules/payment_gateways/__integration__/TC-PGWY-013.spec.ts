import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createPaymentSession, getTransactionStatus, postMockWebhook } from './helpers/fixtures'

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'

/**
 * TC-PGWY-013: Forged webhook regression — mock gateway signature verification
 *
 * Covers the historical vulnerability where the template mock gateway adapter's
 * `verifyWebhook` skipped signature checks and the webhook route fell back to
 * attacker-supplied `event.data.metadata.{tenantId,organizationId}` for scope.
 * Together these allowed an unauthenticated caller to POST a forged
 * `payment.captured` event and flip another tenant's transaction to captured.
 *
 * The expected contract now is fail-closed:
 *   - Unsigned or wrong-signature bodies are rejected with 401 and never
 *     mutate any transaction.
 *   - Attacker-chosen `metadata.organizationId` / `metadata.tenantId` are
 *     never trusted by the route or the worker — scope only comes from the
 *     verified `GatewayTransaction`.
 */
test.describe('TC-PGWY-013: Forged webhook regression', () => {
  test('should reject an unsigned forged capture webhook and leave the transaction untouched', async ({ request }) => {
    const token = await getAuthToken(request)

    const session = await createPaymentSession(request, token, {
      providerKey: 'mock',
      amount: 77.00,
      currencyCode: 'USD',
      captureMethod: 'manual',
    })
    expect(session.status).toBe('authorized')

    // PoC from the original bug report: POST a forged webhook with the victim's
    // sessionId, a 'captured' status, and attacker-controlled metadata. Without
    // signature verification and with metadata-based scope, this used to land.
    const forgedResponse = await request.fetch(`${BASE_URL}/api/payment_gateways/webhook/mock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({
        type: 'payment.captured',
        id: `attacker_evt_${Date.now()}`,
        data: {
          id: session.sessionId,
          status: 'captured',
          amount: 77.00,
          metadata: {
            organizationId: '00000000-0000-0000-0000-000000000000',
            tenantId: '00000000-0000-0000-0000-000000000000',
          },
        },
      }),
    })

    expect(forgedResponse.status()).toBe(401)

    // Allow any background processing to settle; the transaction must stay authorized.
    await new Promise((resolve) => setTimeout(resolve, 500))
    const status = await getTransactionStatus(request, token, session.transactionId)
    expect(status.status).toBe('authorized')
  })

  test('should reject a forged capture webhook that ships an invalid HMAC signature', async ({ request }) => {
    const token = await getAuthToken(request)

    const session = await createPaymentSession(request, token, {
      providerKey: 'mock',
      amount: 33.50,
      currencyCode: 'USD',
      captureMethod: 'manual',
    })
    expect(session.status).toBe('authorized')

    // Valid-looking payload but wrong signature (signed with a bogus secret).
    const response = await postMockWebhook(request, {
      token,
      secret: 'attacker-guessed-secret',
      payload: {
        type: 'payment.captured',
        id: `attacker_evt_${Date.now()}`,
        data: {
          id: session.sessionId,
          status: 'captured',
          amount: 33.50,
          metadata: {
            organizationId: '00000000-0000-0000-0000-000000000000',
            tenantId: '00000000-0000-0000-0000-000000000000',
          },
        },
      },
    })

    expect(response.status()).toBe(401)

    await new Promise((resolve) => setTimeout(resolve, 500))
    const status = await getTransactionStatus(request, token, session.transactionId)
    expect(status.status).toBe('authorized')
  })

  test('should ignore attacker-supplied metadata even when the signature is valid', async ({ request }) => {
    const token = await getAuthToken(request)

    const session = await createPaymentSession(request, token, {
      providerKey: 'mock',
      amount: 12.00,
      currencyCode: 'USD',
      captureMethod: 'manual',
    })
    expect(session.status).toBe('authorized')

    // Correctly signed webhook, but the payload carries bogus metadata that
    // points at a different (non-existent) tenant/org. The route MUST derive
    // scope solely from the verified GatewayTransaction, so capture still
    // applies to the legitimate owner and the metadata is inert.
    const response = await postMockWebhook(request, {
      token,
      payload: {
        type: 'payment.captured',
        id: `legit_evt_${Date.now()}`,
        data: {
          id: session.sessionId,
          status: 'captured',
          amount: 12.00,
          metadata: {
            organizationId: '00000000-0000-0000-0000-000000000000',
            tenantId: '00000000-0000-0000-0000-000000000000',
          },
        },
      },
    })

    expect(response.status()).toBe(202)

    // The transaction belongs to the authenticated tenant, so the capture
    // should succeed for them even though attacker metadata pointed elsewhere.
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
