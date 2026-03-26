import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createCustomerData,
  createFixedTemplateInput,
  createLinkFixture,
  deleteCheckoutEntityIfExists,
  submitPayLink,
} from './helpers/fixtures'

test.describe('TC-CHKT-034: Required terms/privacy consent blocks submit when unchecked', () => {
  test('returns field-level validation errors until all required legal consents are accepted', async ({ request }) => {
    let token: string | null = null
    let linkId: string | null = null

    try {
      token = await getAuthToken(request)
      const link = await createLinkFixture(request, token, {
        ...createFixedTemplateInput({
          status: 'active',
          legalDocuments: {
            terms: { title: 'Terms of Service', markdown: 'Terms body', required: true },
            privacyPolicy: { title: 'Privacy Policy', markdown: 'Privacy body', required: true },
          },
        }),
      })
      linkId = link.id

      const response = await submitPayLink(request, link.slug, {
        customerData: createCustomerData(),
        acceptedLegalConsents: {},
        amount: 49.99,
      })
      expect(response.status()).toBe(422)
      expect(await response.json()).toMatchObject({
        error: 'checkout.payPage.validation.fixErrors',
        fieldErrors: {
          'acceptedLegalConsents.terms': 'checkout.payPage.validation.documentRequired',
          'acceptedLegalConsents.privacyPolicy': 'checkout.payPage.validation.documentRequired',
        },
      })
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })
})
