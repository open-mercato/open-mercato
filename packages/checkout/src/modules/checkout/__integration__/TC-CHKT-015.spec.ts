import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createCustomerData,
  createFixedTemplateInput,
  createLinkFixture,
  deleteCheckoutEntityIfExists,
  submitPayLink,
} from './helpers/fixtures'

test.describe('TC-CHKT-015: Usage limit enforcement', () => {
  test('blocks a second payment when maxCompletions is exhausted', async ({ request }) => {
    let token: string | null = null
    let linkId: string | null = null

    try {
      token = await getAuthToken(request)
      const link = await createLinkFixture(request, token, {
        ...createFixedTemplateInput({
          status: 'active',
          maxCompletions: 1,
        }),
      })
      linkId = link.id

      const firstResponse = await submitPayLink(request, link.slug, {
        customerData: createCustomerData(),
        acceptedLegalConsents: {},
        amount: 49.99,
      })
      expect(firstResponse.status()).toBe(201)

      const secondResponse = await submitPayLink(request, link.slug, {
        customerData: createCustomerData(),
        acceptedLegalConsents: {},
        amount: 49.99,
      })
      expect(secondResponse.status()).toBe(422)

      const body = await secondResponse.json()
      expect(body.error).toContain('no longer available')
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })
})
