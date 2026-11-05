import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createCustomerData,
  createFixedTemplateInput,
  createLinkFixture,
  deleteCheckoutEntityIfExists,
  readPublicPayLink,
  submitPayLink,
  verifyPayLinkPassword,
} from './helpers/fixtures'

test.describe('TC-CHKT-010: Password-protected page flow', () => {
  test('requires password verification before the full pay page and submit flow are available', async ({ request }) => {
    let token: string | null = null
    let linkId: string | null = null

    try {
      token = await getAuthToken(request)
      const link = await createLinkFixture(request, token, {
        ...createFixedTemplateInput({
          status: 'active',
          password: 's3cret-checkout',
        }),
      })
      linkId = link.id

      const initialResponse = await readPublicPayLink(request, link.slug)
      expect(initialResponse.ok()).toBeTruthy()
      expect(await initialResponse.json()).toMatchObject({ requiresPassword: true })

      const blockedSubmit = await submitPayLink(request, link.slug, {
        customerData: createCustomerData(),
        acceptedLegalConsents: {},
        amount: 49.99,
      })
      expect(blockedSubmit.status()).toBe(401)

      const verifyResponse = await verifyPayLinkPassword(request, link.slug, 's3cret-checkout')
      expect(verifyResponse.ok()).toBeTruthy()

      const setCookie = verifyResponse.headers()['set-cookie']
      expect(setCookie).toContain('om_checkout_access=')

      const unlockedResponse = await readPublicPayLink(request, link.slug, {
        headers: { cookie: setCookie },
      })
      expect(unlockedResponse.ok()).toBeTruthy()
      expect(await unlockedResponse.json()).toMatchObject({ requiresPassword: false, slug: link.slug })
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })
})
