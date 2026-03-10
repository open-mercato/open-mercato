import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createPaymentSession, capturePayment, refundPayment, getTransactionStatus } from './helpers/fixtures'

/**
 * TC-PGWY-008: Partial refund
 *
 * Verifies that a captured payment can be partially refunded by passing an
 * `amount` smaller than the full captured amount. The mock adapter tracks
 * cumulative refund totals and reports `partially_refunded` when the
 * refunded amount is less than the captured amount.
 */
test.describe('TC-PGWY-008: Partial refund', () => {
  test('should partially refund a captured payment and reflect partially_refunded status', async ({ request }) => {
    const token = await getAuthToken(request)

    const session = await createPaymentSession(request, token, {
      providerKey: 'mock',
      amount: 100.00,
      currencyCode: 'USD',
      captureMethod: 'manual',
    })
    expect(session.status).toBe('authorized')

    const capture = await capturePayment(request, token, session.transactionId)
    expect(capture.status).toBe('captured')
    expect(capture.capturedAmount).toBe(100.00)

    const refund = await refundPayment(request, token, session.transactionId, 30.00, 'Partial return')
    expect(refund.status).toBe('partially_refunded')
    expect(refund.refundedAmount).toBe(30.00)
    expect(refund.refundId).toBeTruthy()

    const status = await getTransactionStatus(request, token, session.transactionId)
    expect(status.status).toBe('partially_refunded')
  })

  test('should fully refund after a series of partial refunds', async ({ request }) => {
    const token = await getAuthToken(request)

    const session = await createPaymentSession(request, token, {
      providerKey: 'mock',
      amount: 60.00,
      currencyCode: 'EUR',
      captureMethod: 'manual',
    })
    expect(session.status).toBe('authorized')

    await capturePayment(request, token, session.transactionId)

    const firstRefund = await refundPayment(request, token, session.transactionId, 20.00, 'First partial')
    expect(firstRefund.status).toBe('partially_refunded')
    expect(firstRefund.refundedAmount).toBe(20.00)

    const secondRefund = await refundPayment(request, token, session.transactionId, 40.00, 'Remaining amount')
    expect(secondRefund.status).toBe('refunded')
    expect(secondRefund.refundedAmount).toBe(40.00)

    const status = await getTransactionStatus(request, token, session.transactionId)
    expect(status.status).toBe('refunded')
  })
})
