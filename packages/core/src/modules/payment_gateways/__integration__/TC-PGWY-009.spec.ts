import { expect, test } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createPaymentSession,
  capturePayment,
  refundPayment,
  getTransactionStatus,
} from './helpers/fixtures'

/**
 * TC-PGWY-009: Manual gateway actions enforce the status machine (#3271)
 *
 * Manual capture/refund/cancel no longer trust the adapter result blindly. The
 * service pre-checks the current transaction status and validates the adapter
 * result before persisting it, so a terminal transaction (cancelled, refunded,
 * failed, expired) can never be moved back into an active or captured state.
 * Same-status responses are treated as idempotent.
 */
test.describe('TC-PGWY-009: Manual actions enforce status-machine transitions', () => {
  test('treats a second capture as idempotent without corrupting transaction state', async ({ request }) => {
    const token = await getAuthToken(request)

    const session = await createPaymentSession(request, token, {
      providerKey: 'mock',
      amount: 80.00,
      currencyCode: 'USD',
      captureMethod: 'manual',
    })
    expect(session.status).toBe('authorized')

    const firstCapture = await capturePayment(request, token, session.transactionId)
    expect(firstCapture.status).toBe('captured')
    expect(firstCapture.capturedAmount).toBe(80.00)

    const statusAfterFirst = await getTransactionStatus(request, token, session.transactionId)
    expect(statusAfterFirst.status).toBe('captured')

    // Second capture: current status is already `captured`, so the same-status
    // adapter response is idempotent — 200 with status unchanged.
    const secondResponse = await apiRequest(request, 'POST', '/api/payment_gateways/capture', {
      token,
      data: { transactionId: session.transactionId },
    })
    expect(secondResponse.ok()).toBe(true)
    const secondCapture = await secondResponse.json()
    expect(secondCapture.status).toBe('captured')

    const finalStatus = await getTransactionStatus(request, token, session.transactionId)
    expect(finalStatus.status).toBe('captured')
  })

  test('rejects capture on a cancelled payment and keeps it cancelled', async ({ request }) => {
    const token = await getAuthToken(request)

    const session = await createPaymentSession(request, token, {
      providerKey: 'mock',
      amount: 45.00,
      currencyCode: 'USD',
      captureMethod: 'manual',
    })
    expect(session.status).toBe('authorized')

    const cancelResponse = await apiRequest(request, 'POST', '/api/payment_gateways/cancel', {
      token,
      data: { transactionId: session.transactionId },
    })
    expect(cancelResponse.ok()).toBe(true)

    const statusAfterCancel = await getTransactionStatus(request, token, session.transactionId)
    expect(statusAfterCancel.status).toBe('cancelled')

    // Capture on a cancelled (terminal) transaction must be rejected by the
    // service status-machine guard, regardless of the permissive mock adapter.
    const captureResponse = await apiRequest(request, 'POST', '/api/payment_gateways/capture', {
      token,
      data: { transactionId: session.transactionId },
    })
    expect(captureResponse.ok()).toBe(false)
    expect(captureResponse.status()).toBe(409)

    const finalStatus = await getTransactionStatus(request, token, session.transactionId)
    expect(finalStatus.status).toBe('cancelled')
  })

  test('rejects capture and cancel on a refunded payment and keeps it refunded', async ({ request }) => {
    const token = await getAuthToken(request)

    const session = await createPaymentSession(request, token, {
      providerKey: 'mock',
      amount: 60.00,
      currencyCode: 'USD',
      captureMethod: 'manual',
    })
    expect(session.status).toBe('authorized')

    const capture = await capturePayment(request, token, session.transactionId)
    expect(capture.status).toBe('captured')

    const refund = await refundPayment(request, token, session.transactionId)
    expect(refund.status).toBe('refunded')

    const statusAfterRefund = await getTransactionStatus(request, token, session.transactionId)
    expect(statusAfterRefund.status).toBe('refunded')

    // Capture on a refunded (terminal) transaction must be rejected.
    const captureResponse = await apiRequest(request, 'POST', '/api/payment_gateways/capture', {
      token,
      data: { transactionId: session.transactionId },
    })
    expect(captureResponse.ok()).toBe(false)
    expect(captureResponse.status()).toBe(409)

    // Cancel on a refunded (terminal) transaction must be rejected too.
    const cancelResponse = await apiRequest(request, 'POST', '/api/payment_gateways/cancel', {
      token,
      data: { transactionId: session.transactionId },
    })
    expect(cancelResponse.ok()).toBe(false)
    expect(cancelResponse.status()).toBe(409)

    const finalStatus = await getTransactionStatus(request, token, session.transactionId)
    expect(finalStatus.status).toBe('refunded')
  })
})
