import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createCustomerData,
  createFixedTemplateInput,
  createLinkFixture,
  deleteCheckoutEntityIfExists,
  findGatewayTransactionIdForCheckout,
  readGatewayTransaction,
  sendMockGatewayWebhook,
  submitPayLink,
  waitForCheckoutStatus,
} from './helpers/fixtures'

test.describe('TC-CHKT-022: Link deletion blocked with active transactions', () => {
  test('returns 422 while the link still has an in-flight payment reservation', async ({ request }) => {
    let token: string | null = null
    let linkId: string | null = null
    let transactionId: string | null = null

    try {
      token = await getAuthToken(request)
      const link = await createLinkFixture(request, token, {
        ...createFixedTemplateInput({
          status: 'active',
          gatewayProviderKey: 'mock_processing',
        }),
      })
      linkId = link.id

      const submitResponse = await submitPayLink(request, link.slug, {
        customerData: createCustomerData(),
        acceptedLegalConsents: {},
        amount: 49.99,
      })
      expect(submitResponse.status()).toBe(201)
      const submitBody = await submitResponse.json()
      transactionId = submitBody.transactionId

      const deleteResponse = await request.fetch(
        `${process.env.BASE_URL || 'http://localhost:3000'}/api/checkout/links/${encodeURIComponent(link.id)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        },
      )
      expect(deleteResponse.status()).toBe(422)
      expect(await deleteResponse.json()).toMatchObject({
        error: expect.stringContaining('cannot be deleted'),
      })
    } finally {
      if (token && transactionId) {
        const gatewayTransactionId = await findGatewayTransactionIdForCheckout(request, token, transactionId)
        const gatewayTransaction = await readGatewayTransaction(request, token, gatewayTransactionId)
        if (gatewayTransaction.providerSessionId) {
          await sendMockGatewayWebhook(request, token, gatewayTransaction.providerSessionId, 'captured', 49.99, {
            providerKey: 'mock_processing',
          })
          await waitForCheckoutStatus(request, token, transactionId, 'completed')
        }
      }
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })
})
