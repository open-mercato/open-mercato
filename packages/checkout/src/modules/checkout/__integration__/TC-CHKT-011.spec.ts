import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createCustomerData,
  createFixedTemplateInput,
  createLinkFixture,
  deleteCheckoutEntityIfExists,
  readCheckoutTransaction,
  readLink,
  submitPayLink,
} from './helpers/fixtures'

test.describe('TC-CHKT-011: Submit fixed-price payment', () => {
  test('creates a completed checkout transaction for the configured fixed amount', async ({ request }) => {
    let token: string | null = null
    let linkId: string | null = null

    try {
      token = await getAuthToken(request)
      const link = await createLinkFixture(request, token, {
        ...createFixedTemplateInput({ status: 'active' }),
      })
      linkId = link.id

      const response = await submitPayLink(request, link.slug, {
        customerData: createCustomerData(),
        acceptedLegalConsents: {},
        amount: 49.99,
      })
      expect(response.status()).toBe(201)

      const body = await response.json()
      const transaction = await readCheckoutTransaction(request, token, body.transactionId)
      const refreshedLink = await readLink(request, token, link.id)

      expect(transaction.status).toBe('completed')
      expect(transaction.paymentStatus).toBe('captured')
      expect(refreshedLink.completionCount).toBe(1)
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })
})
