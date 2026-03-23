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

test.describe('TC-CHKT-016: Transaction list filtered by link', () => {
  test('returns only transactions for the requested link id', async ({ request }) => {
    let token: string | null = null
    let firstLinkId: string | null = null
    let secondLinkId: string | null = null

    try {
      token = await getAuthToken(request)
      const first = await createLinkFixture(request, token, {
        ...createFixedTemplateInput({ status: 'active' }),
      })
      const second = await createLinkFixture(request, token, {
        ...createFixedTemplateInput({ status: 'active' }),
      })
      firstLinkId = first.id
      secondLinkId = second.id

      await submitPayLink(request, first.slug, {
        customerData: createCustomerData(),
        acceptedLegalConsents: {},
        amount: 49.99,
      })
      await submitPayLink(request, second.slug, {
        customerData: createCustomerData(),
        acceptedLegalConsents: {},
        amount: 49.99,
      })

      const filtered = await listCheckoutTransactions(
        request,
        token,
        `linkId=${encodeURIComponent(first.id)}&page=1&pageSize=50`,
      )
      expect(filtered.items.length).toBeGreaterThan(0)
      expect(filtered.items.every((item) => item.linkId === first.id)).toBeTruthy()
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', firstLinkId)
      await deleteCheckoutEntityIfExists(request, token, 'links', secondLinkId)
    }
  })
})
