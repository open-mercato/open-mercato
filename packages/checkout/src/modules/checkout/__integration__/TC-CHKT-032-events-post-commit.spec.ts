import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  clearCapturedExampleEvents,
  createCustomerData,
  createFixedTemplateInput,
  createLinkFixture,
  createTemplateFixture,
  deleteCheckoutEntityIfExists,
  readCheckoutTransaction,
  submitPayLink,
  waitForCapturedExampleEvents,
} from './helpers/fixtures'

test.describe('TC-CHKT-032 (events): Checkout emits webhook-ready customer-data/session-start lifecycle events only after commit', () => {
  test('captures post-commit event payloads that reference persisted checkout state', async ({ request }) => {
    let token: string | null = null
    let templateId: string | null = null
    let linkId: string | null = null

    try {
      token = await getAuthToken(request)
      await clearCapturedExampleEvents(request, token)

      templateId = await createTemplateFixture(request, token, createFixedTemplateInput({
        customFieldsetCode: 'service_package',
        customFields: {
          service_deliverables: 'Strategy workshop',
        },
      }))

      const link = await createLinkFixture(request, token, {
        ...createFixedTemplateInput({
          status: 'active',
          templateId,
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

      const events = await waitForCapturedExampleEvents(request, token, [
        'checkout.transaction.customerDataCaptured',
        'checkout.transaction.sessionStarted',
      ])

      const customerDataCaptured = events.find((event) => event.event === 'checkout.transaction.customerDataCaptured')
      const sessionStarted = events.find((event) => event.event === 'checkout.transaction.sessionStarted')
      expect(customerDataCaptured?.payload).toMatchObject({
        transactionId: submitBody.transactionId,
        linkId: link.id,
        templateId,
        slug: link.slug,
        status: 'processing',
        amount: 49.99,
        currency: 'USD',
        gatewayProvider: 'mock',
      })
      expect(sessionStarted?.payload).toMatchObject({
        transactionId: submitBody.transactionId,
        linkId: link.id,
        templateId,
        slug: link.slug,
        gatewayProvider: 'mock',
      })
      expect(typeof sessionStarted?.payload.gatewayTransactionId).toBe('string')
      expect(typeof sessionStarted?.payload.occurredAt).toBe('string')

      const storedTransaction = await readCheckoutTransaction(request, token, submitBody.transactionId)
      expect(storedTransaction.id).toBe(submitBody.transactionId)
      expect(storedTransaction.gatewayTransactionId).toBe(sessionStarted?.payload.gatewayTransactionId)
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
      await deleteCheckoutEntityIfExists(request, token, 'templates', templateId)
    }
  })
})
