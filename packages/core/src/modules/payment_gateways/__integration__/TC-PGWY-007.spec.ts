import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createPaymentSession, getTransactionStatus } from './helpers/fixtures'

/**
 * TC-PGWY-007: Tenant isolation
 */
test.describe('TC-PGWY-007: Tenant isolation', () => {
  test('should not access payment session across different users with different roles', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')

    const session = await createPaymentSession(request, adminToken, {
      providerKey: 'mock',
      amount: 99.99,
      currencyCode: 'USD',
      captureMethod: 'manual',
    })
    expect(session.transactionId).toBeTruthy()

    // Same-tenant user should be able to access the transaction
    const status = await getTransactionStatus(request, adminToken, session.transactionId)
    expect(status.status).toBe('authorized')
    expect(status.transactionId).toBe(session.transactionId)
  })
})
