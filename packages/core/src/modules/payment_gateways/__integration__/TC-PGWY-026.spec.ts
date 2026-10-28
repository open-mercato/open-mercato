import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { capturePayment, createPaymentSession, getTransactionDetails } from './helpers/fixtures'

/**
 * TC-PGWY-026: A manual cancel never strands funds that were already captured
 *
 * Cancelling a partially captured payment used to move it to the terminal `cancelled` status
 * while the captured amount stayed on the ledger, so the money could never be refunded through
 * Open Mercato afterwards. The cancel is now refused with a 409 and the payment stays refundable.
 *
 * The mock gateway reports every capture as a full one, so the spec captures part of the
 * authorization through the API and then marks the transaction `partially_captured` directly in
 * the database, the state a multi-capture provider would report. It MUST run under a coherent
 * app+DB stack (the `yarn test:integration` harness).
 */
test.describe('TC-PGWY-026: Cancel with captured funds', () => {
  test('refuses to cancel a partially captured payment and keeps it refundable', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = `${Date.now()}`
    let transactionId: string | null = null

    try {
      const session = await createPaymentSession(request, token, {
        providerKey: 'mock',
        amount: 100.00,
        currencyCode: 'USD',
        captureMethod: 'manual',
      })
      transactionId = session.transactionId
      expect(session.status).toBe('authorized')

      const captured = await capturePayment(request, token, session.transactionId, 40.00)
      expect(captured.capturedAmount).toBe(40.00)

      await withClient(async (client) => {
        await client.query(
          "update gateway_transactions set unified_status = 'partially_captured' where id = $1",
          [session.transactionId],
        )
      })

      const cancel = await apiRequest(request, 'POST', '/api/payment_gateways/cancel', {
        token,
        data: { transactionId: session.transactionId, reason: 'buyer cancelled', operationId: `cancel-${suffix}` },
      })
      expect(cancel.status()).toBe(409)
      const cancelBody = await cancel.json()
      expect(cancelBody.code).toBe('payment_cancel_captured_funds')
      expect(typeof cancelBody.error).toBe('string')
      expect(cancelBody.error).not.toContain('payment_gateways.errors')

      const afterCancel = await getTransactionDetails(request, token, session.transactionId)
      expect(afterCancel.transaction.unifiedStatus).toBe('partially_captured')

      const refund = await apiRequest(request, 'POST', '/api/payment_gateways/refund', {
        token,
        data: { transactionId: session.transactionId, amount: 40.00, reason: 'buyer cancelled', operationId: `refund-${suffix}` },
      })
      expect(refund.ok()).toBe(true)
      expect((await refund.json()).status).toBe('refunded')

      const afterRefund = await getTransactionDetails(request, token, session.transactionId)
      expect(afterRefund.transaction.unifiedStatus).toBe('refunded')
    } finally {
      if (transactionId) {
        const id = transactionId
        await withClient(async (client) => {
          await client.query('delete from gateway_payment_operations where transaction_id = $1', [id])
          await client.query('delete from gateway_transactions where id = $1', [id])
        })
      }
    }
  })
})
