import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createCustomerData,
  createCustomAmountTemplateInput,
  createLinkFixture,
  deleteCheckoutEntityIfExists,
  readCheckoutTransaction,
  submitPayLink,
} from './helpers/fixtures'

test.describe('TC-CHKT-012: Submit custom-amount payment (valid range)', () => {
  test('accepts a customer-entered amount within the configured range', async ({ request }) => {
    let token: string | null = null
    let linkId: string | null = null

    try {
      token = await getAuthToken(request)
      const link = await createLinkFixture(request, token, createCustomAmountTemplateInput())
      linkId = link.id

      const response = await submitPayLink(request, link.slug, {
        customerData: createCustomerData(),
        acceptedLegalConsents: {},
        amount: 55,
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
