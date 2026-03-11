import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createPaymentSession, getTransactionDetails, listTransactions } from './helpers/fixtures'

/**
 * TC-PGWY-012: Transaction tracking list and detail APIs
 */
test.describe('TC-PGWY-012: Transaction tracking APIs', () => {
  test('should list transactions and expose transaction-scoped details with logs', async ({ request }) => {
    const token = await getAuthToken(request)
    const session = await createPaymentSession(request, token, {
      providerKey: 'mock',
      amount: 64.25,
      currencyCode: 'USD',
      captureMethod: 'manual',
    })

    const list = await listTransactions(request, token)
    expect(list.total).toBeGreaterThan(0)
    expect(list.items.some((item) => item.id === session.transactionId)).toBe(true)

    const detail = await getTransactionDetails(request, token, session.transactionId)
    expect(detail.transaction.id).toBe(session.transactionId)
    expect(detail.transaction.paymentId).toBe(session.paymentId)
    expect(detail.logs.some((log) => log.message === 'Payment session created')).toBe(true)
  })
})
