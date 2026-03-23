import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createCustomerData,
  createFixedTemplateInput,
  createLinkFixture,
  deleteCheckoutEntityIfExists,
  readCheckoutStatus,
  submitPayLink,
} from './helpers/fixtures'

test.describe('TC-CHKT-026: Status endpoint rejects transaction from another slug', () => {
  test('returns 404 when a transaction id is queried under a different pay-link slug', async ({ request }) => {
    let token: string | null = null
    let firstLinkId: string | null = null
    let secondLinkId: string | null = null

    try {
      token = await getAuthToken(request)
      const firstLink = await createLinkFixture(request, token, {
        ...createFixedTemplateInput({ status: 'active' }),
      })
      const secondLink = await createLinkFixture(request, token, {
        ...createFixedTemplateInput({ status: 'active' }),
      })
      firstLinkId = firstLink.id
      secondLinkId = secondLink.id

      const submitResponse = await submitPayLink(request, firstLink.slug, {
        customerData: createCustomerData(),
        acceptedLegalConsents: {},
        amount: 49.99,
      })
      expect(submitResponse.status()).toBe(201)
      const submitBody = await submitResponse.json()

      const statusResponse = await readCheckoutStatus(request, secondLink.slug, submitBody.transactionId)
      expect(statusResponse.status()).toBe(404)
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', firstLinkId)
      await deleteCheckoutEntityIfExists(request, token, 'links', secondLinkId)
    }
  })
})
