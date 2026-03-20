import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  clearCapturedExampleEvents,
  createCustomerData,
  createFixedTemplateInput,
  createLinkFixture,
  createTemplateFixture,
  deleteCheckoutEntityIfExists,
  findGatewayTransactionIdForCheckout,
  listCapturedExampleEvents,
  readGatewayTransaction,
  sendMockGatewayWebhook,
  submitPayLink,
  waitForCapturedExampleEvents,
  waitForCheckoutStatus,
} from './helpers/fixtures'

test.describe('TC-CHKT-033: External webhook subscription can receive checkout success/failure automation events with stable identifiers and no secrets', () => {
  test('emits webhook-safe completed and failed payloads with stable identifiers for both terminal states', async ({ request }) => {
    let token: string | null = null
    let templateId: string | null = null
    let completedLinkId: string | null = null
    let failedLinkId: string | null = null
    let failedTransactionId: string | null = null

    try {
      token = await getAuthToken(request)
      await clearCapturedExampleEvents(request, token)

      templateId = await createTemplateFixture(request, token, createFixedTemplateInput())

      const completedLink = await createLinkFixture(request, token, {
        ...createFixedTemplateInput({
          status: 'active',
          templateId,
        }),
      })
      completedLinkId = completedLink.id

      const completedSubmit = await submitPayLink(request, completedLink.slug, {
        customerData: createCustomerData(),
        acceptedLegalConsents: {},
        amount: 49.99,
      })
      expect(completedSubmit.status()).toBe(201)
      const completedBody = await completedSubmit.json()

      const failedLink = await createLinkFixture(request, token, {
        ...createFixedTemplateInput({
          status: 'active',
          templateId,
          gatewayProviderKey: 'mock_processing',
        }),
      })
      failedLinkId = failedLink.id

      const failedSubmit = await submitPayLink(request, failedLink.slug, {
        customerData: createCustomerData(),
        acceptedLegalConsents: {},
        amount: 49.99,
      })
      expect(failedSubmit.status()).toBe(201)
      const failedBody = await failedSubmit.json()
      failedTransactionId = failedBody.transactionId

      const gatewayTransactionId = await findGatewayTransactionIdForCheckout(request, token, failedBody.transactionId)
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
      await waitForCheckoutStatus(request, token, failedBody.transactionId, 'failed')

      await waitForCapturedExampleEvents(request, token, [
        'checkout.transaction.completed',
        'checkout.transaction.failed',
      ])
      const events = await listCapturedExampleEvents(request, token)
      const completedEvent = events.find((event) => event.event === 'checkout.transaction.completed' && event.payload.transactionId === completedBody.transactionId)
      const failedEvent = events.find((event) => event.event === 'checkout.transaction.failed' && event.payload.transactionId === failedBody.transactionId)

      for (const [eventName, eventPayload, linkId, slug, gatewayProvider] of [
        ['checkout.transaction.completed', completedEvent?.payload, completedLink.id, completedLink.slug, 'mock'],
        ['checkout.transaction.failed', failedEvent?.payload, failedLink.id, failedLink.slug, 'mock_processing'],
      ] as const) {
        expect(eventPayload, `${eventName} payload missing`).toBeTruthy()
        expect(eventPayload).toMatchObject({
          linkId,
          templateId,
          slug,
          gatewayProvider,
          amount: 49.99,
          currency: 'USD',
        })
        expect(typeof eventPayload?.transactionId).toBe('string')
        expect(typeof eventPayload?.gatewayTransactionId).toBe('string')
        expect(typeof eventPayload?.occurredAt).toBe('string')
        expect(eventPayload).not.toHaveProperty('customerData')
        expect(eventPayload).not.toHaveProperty('acceptedLegalConsents')
        expect(eventPayload).not.toHaveProperty('gatewaySettings')
        expect(eventPayload).not.toHaveProperty('passwordHash')
      }
    } finally {
      if (failedTransactionId && token) {
        await waitForCheckoutStatus(request, token, failedTransactionId, 'failed')
      }
      await deleteCheckoutEntityIfExists(request, token, 'links', completedLinkId)
      await deleteCheckoutEntityIfExists(request, token, 'links', failedLinkId)
      await deleteCheckoutEntityIfExists(request, token, 'templates', templateId)
    }
  })
})
