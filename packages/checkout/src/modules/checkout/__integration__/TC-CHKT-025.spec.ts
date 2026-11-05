import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createCustomerData,
  createFixedTemplateInput,
  createLinkFixture,
  deleteCheckoutEntityIfExists,
  listCheckoutTransactions,
  submitPayLink,
} from './helpers/fixtures'

test.describe('TC-CHKT-025: Submit replay with same Idempotency-Key does not create duplicate transactions', () => {
  test('returns the original response payload and preserves a single checkout transaction', async ({ request }) => {
    let token: string | null = null
    let linkId: string | null = null

    try {
      token = await getAuthToken(request)
      const link = await createLinkFixture(request, token, {
        ...createFixedTemplateInput({ status: 'active' }),
      })
      linkId = link.id

      const idempotencyKey = `qa-checkout-idempotency-${Date.now()}`
      const firstResponse = await submitPayLink(request, link.slug, {
        customerData: createCustomerData(),
        acceptedLegalConsents: {},
        amount: 49.99,
      }, {
        idempotencyKey,
      })
      expect(firstResponse.status()).toBe(201)
      const firstBody = await firstResponse.json()

      const secondResponse = await submitPayLink(request, link.slug, {
        customerData: createCustomerData({ email: 'replayed@example.test' }),
        acceptedLegalConsents: {},
        amount: 49.99,
      }, {
        idempotencyKey,
      })
      expect(secondResponse.status()).toBe(200)
      const secondBody = await secondResponse.json()

      expect(secondBody.transactionId).toBe(firstBody.transactionId)
      expect(secondBody.paymentSession).toEqual(firstBody.paymentSession)

      const transactions = await listCheckoutTransactions(request, token, `linkId=${encodeURIComponent(link.id)}`)
      expect(transactions.total).toBe(1)
      expect(transactions.items[0]?.id).toBe(firstBody.transactionId)
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })
})
