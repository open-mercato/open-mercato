import { expect, request as playwrightRequest, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createCustomerData,
  createFixedTemplateInput,
  createLinkFixture,
  deleteCheckoutEntityIfExists,
  readCheckoutStatus,
  submitPayLink,
  verifyPayLinkPassword,
} from './helpers/fixtures'

test.describe('TC-CHKT-027: Password-protected status/success page requires verified session', () => {
  test('blocks status polling when the password-verification cookie is missing', async ({ request }) => {
    let token: string | null = null
    let linkId: string | null = null
    let isolatedRequest: Awaited<ReturnType<typeof playwrightRequest.newContext>> | null = null

    try {
      token = await getAuthToken(request)
      const link = await createLinkFixture(request, token, {
        ...createFixedTemplateInput({
          status: 'active',
          password: 's3cret-status',
        }),
      })
      linkId = link.id

      const verifyResponse = await verifyPayLinkPassword(request, link.slug, 's3cret-status')
      expect(verifyResponse.ok()).toBeTruthy()
      const accessCookie = verifyResponse.headers()['set-cookie']
      expect(accessCookie).toContain('om_checkout_access=')

      const submitResponse = await submitPayLink(request, link.slug, {
        customerData: createCustomerData(),
        acceptedLegalConsents: {},
        amount: 49.99,
      }, {
        headers: { cookie: accessCookie },
      })
      expect(submitResponse.status()).toBe(201)
      const submitBody = await submitResponse.json()

      isolatedRequest = await playwrightRequest.newContext({
        baseURL: process.env.BASE_URL || 'http://localhost:3000',
      })
      const blockedStatus = await readCheckoutStatus(isolatedRequest, link.slug, submitBody.transactionId)
      expect(blockedStatus.status()).toBe(401)

      const allowedStatus = await readCheckoutStatus(request, link.slug, submitBody.transactionId, {
        headers: { cookie: accessCookie },
      })
      expect(allowedStatus.status()).toBe(200)
    } finally {
      await isolatedRequest?.dispose()
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })
})
