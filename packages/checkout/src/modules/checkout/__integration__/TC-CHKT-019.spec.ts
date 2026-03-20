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

test.describe('TC-CHKT-019: Gateway event updates checkout transaction status', () => {
  test('moves a processing checkout transaction to failed after a gateway webhook event', async ({ request }) => {
    let token: string | null = null
    let linkId: string | null = null

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

      const gatewayTransactionId = await findGatewayTransactionIdForCheckout(request, token, submitBody.transactionId)
      const gatewayTransaction = await readGatewayTransaction(request, token, gatewayTransactionId)
      expect(gatewayTransaction.providerSessionId).toBeTruthy()

      const webhookResponse = await sendMockGatewayWebhook(
        request,
        token,
        gatewayTransaction.providerSessionId!,
        'failed',
        49.99,
        { providerKey: 'mock_processing' },
      )
      expect(webhookResponse.status()).toBe(202)

      const transaction = await waitForCheckoutStatus(request, token, submitBody.transactionId, 'failed')
      expect(transaction.status).toBe('failed')
      expect(transaction.paymentStatus).toBe('failed')
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })
})
