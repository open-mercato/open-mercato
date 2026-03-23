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

test.describe('TC-CHKT-024: Amount tampering prevention (fixed mode)', () => {
  test('rejects a submitted amount that does not match the fixed-price configuration', async ({ request }) => {
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
        amount: 1,
      })
      expect(response.status()).toBe(422)

      const transactions = await listCheckoutTransactions(request, token, `linkId=${encodeURIComponent(link.id)}`)
      expect(transactions.total).toBe(0)
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })
})
