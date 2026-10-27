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

test.describe('TC-CHKT-042: Transaction search over encrypted customer data', () => {
  test('finds a newly created transaction through its token index', async ({ request }) => {
    const email = `token-search-${Date.now()}@example.test`
    let token: string | null = null
    let linkId: string | null = null

    try {
      token = await getAuthToken(request)
      const link = await createLinkFixture(request, token, createFixedTemplateInput({ status: 'active' }))
      linkId = link.id
      const submitted = await submitPayLink(request, link.slug, {
        customerData: createCustomerData({ email }),
        acceptedLegalConsents: {},
        amount: 49.99,
      })
      expect(submitted.ok()).toBeTruthy()

      await expect.poll(async () => {
        const result = await listCheckoutTransactions(
          request,
          token!,
          `search=${encodeURIComponent(email)}&page=1&pageSize=10`,
        )
        return result.items.some((item) => item.email === email)
      }, { timeout: 15_000 }).toBeTruthy()
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })
})
