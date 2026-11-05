import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createCustomerData,
  createFixedTemplateInput,
  createLinkFixture,
  deleteCheckoutEntityIfExists,
  submitPayLink,
} from './helpers/fixtures'

test.describe('TC-CHKT-036: Submit payment rejects invalid customer email and phone formats', () => {
  test('returns field errors for malformed email and phone values', async ({ request }) => {
    let token: string | null = null
    let linkId: string | null = null

    try {
      token = await getAuthToken(request)
      const link = await createLinkFixture(request, token, createFixedTemplateInput({ status: 'active' }))
      linkId = link.id

      const response = await submitPayLink(request, link.slug, {
        customerData: createCustomerData({
          email: 'emailwithoutdomain',
          phone: 'wrong phone number',
        }),
        acceptedLegalConsents: {},
        amount: 49.99,
      })

      expect(response.status()).toBe(422)

      const body = await response.json()
      expect(body.fieldErrors).toMatchObject({
        'customerData.email': 'checkout.payPage.validation.invalidEmail',
        'customerData.phone': 'checkout.payPage.validation.invalidPhone',
      })
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })
})
