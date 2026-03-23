import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createCustomerData,
  createLinkFixture,
  createPriceListTemplateInput,
  deleteCheckoutEntityIfExists,
  readCheckoutTransaction,
  submitPayLink,
} from './helpers/fixtures'

test.describe('TC-CHKT-014: Submit price-list payment', () => {
  test('creates a completed transaction for the selected price-list item', async ({ request }) => {
    let token: string | null = null
    let linkId: string | null = null

    try {
      token = await getAuthToken(request)
      const link = await createLinkFixture(request, token, createPriceListTemplateInput())
      linkId = link.id

      const response = await submitPayLink(request, link.slug, {
        customerData: createCustomerData(),
        acceptedLegalConsents: {},
        selectedPriceItemId: 'plus',
        amount: 49.99,
      })
      expect(response.status()).toBe(201)

      const body = await response.json()
      const transaction = await readCheckoutTransaction(request, token, body.transactionId)
      expect(transaction.status).toBe('completed')
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })
})
