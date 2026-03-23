import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createCustomerData,
  createFixedTemplateInput,
  createLinkFixture,
  deleteCheckoutEntityIfExists,
  readCheckoutTransaction,
  submitPayLink,
} from './helpers/fixtures'

test.describe('TC-CHKT-017: Transaction detail with PII', () => {
  test('shows decrypted customer fields to a user with checkout.viewPii', async ({ request }) => {
    let token: string | null = null
    let linkId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      const link = await createLinkFixture(request, token, {
        ...createFixedTemplateInput({ status: 'active' }),
      })
      linkId = link.id

      const customer = createCustomerData()
      const response = await submitPayLink(request, link.slug, {
        customerData: customer,
        acceptedLegalConsents: {},
        amount: 49.99,
      })
      expect(response.status()).toBe(201)

      const body = await response.json()
      const detail = await readCheckoutTransaction(request, token, body.transactionId)
      expect(detail.email).toBe(customer.email)
      expect(detail.firstName).toBe(customer.firstName)
      expect(detail.lastName).toBe(customer.lastName)
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })
})
