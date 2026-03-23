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
  updateLink,
  waitForCheckoutStatus,
} from './helpers/fixtures'

test.describe('TC-CHKT-008: Attempt update on locked link, verify 422', () => {
  test('rejects link edits after the first transaction locks the record', async ({ request }) => {
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
      transactionId = typeof submitBody.transactionId === 'string' ? submitBody.transactionId : null

      const updateResponse = await updateLink(request, token, link.id, {
        title: 'Should fail after lock',
      })
      expect(updateResponse.status()).toBe(422)

      const body = await updateResponse.json()
      expect(body.error).toContain('cannot be edited')
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
