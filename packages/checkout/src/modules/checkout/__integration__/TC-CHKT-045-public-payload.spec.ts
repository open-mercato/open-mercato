import { expect, request as playwrightRequest, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createFixedTemplateInput,
  createLinkFixture,
  deleteCheckoutEntityIfExists,
  readPublicPayLink,
  verifyPayLinkPassword,
} from './helpers/fixtures'

const EMAIL_CONFIGURATION = {
  successEmailSubject: 'Administrative success subject',
  successEmailBody: 'Administrative success body',
  errorEmailSubject: 'Administrative error subject',
  errorEmailBody: 'Administrative error body',
  startEmailSubject: 'Administrative start subject',
  startEmailBody: 'Administrative start body',
  sendSuccessEmail: true,
  sendErrorEmail: true,
  sendStartEmail: true,
}

const ADMIN_ONLY_FIELDS = [
  ...Object.keys(EMAIL_CONFIGURATION),
  'gatewaySettings',
  'passwordHash',
  'logoAttachmentId',
  'customFieldsetCode',
  'templateId',
  'maxCompletions',
  'completionCount',
  'activeReservationCount',
  'isLocked',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'tenantId',
  'organizationId',
]

function expectPublicPayload(body: unknown, linkId: string, preview: boolean) {
  expect(body).toMatchObject({
    id: linkId,
    title: 'Public donation page',
    pricingMode: 'fixed',
    fixedPriceAmount: 49.99,
    fixedPriceCurrencyCode: 'USD',
    fixedPriceIncludesTax: true,
    gatewayProviderKey: 'mock',
    publicCustomFields: [],
    requiresPassword: false,
    remainingUses: 10,
    available: !preview,
    preview,
  })
  for (const field of ADMIN_ONLY_FIELDS) {
    expect(body).not.toHaveProperty(field)
  }
}

test.describe('TC-CHKT-045: Public pay-link response excludes administrative fields', () => {
  for (const password of [null, 'public-payload-password']) {
    test(`keeps admin fields private ${password ? 'after password verification' : 'without a password'}`, async ({ request }) => {
      let token: string | null = null
      let linkId: string | null = null
      const publicRequest = await playwrightRequest.newContext({ storageState: { cookies: [], origins: [] } })

      try {
        token = await getAuthToken(request)
        const link = await createLinkFixture(request, token, createFixedTemplateInput({
          ...EMAIL_CONFIGURATION,
          title: 'Public donation page',
          status: 'active',
          maxCompletions: 10,
          password,
        }))
        linkId = link.id

        const adminResponse = await apiRequest(request, 'GET', `/api/checkout/links/${link.id}`, { token })
        expect(adminResponse.status()).toBe(200)
        expect(await readJsonSafe(adminResponse)).toMatchObject({
          ...EMAIL_CONFIGURATION,
          maxCompletions: 10,
          completionCount: 0,
          activeReservationCount: 0,
          isLocked: false,
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        })

        const accessHeaders: Record<string, string> = {}
        if (password) {
          const challengeResponse = await readPublicPayLink(publicRequest, link.slug)
          expect(challengeResponse.status()).toBe(200)
          expect(await readJsonSafe(challengeResponse)).toEqual({
            requiresPassword: true,
            title: 'Public donation page',
          })

          const verifyResponse = await verifyPayLinkPassword(publicRequest, link.slug, password)
          expect(verifyResponse.status()).toBe(200)
          const accessCookie = verifyResponse.headers()['set-cookie']
          expect(accessCookie).toContain('om_checkout_access=')
          accessHeaders.cookie = accessCookie.split(';')[0]
        }

        const publicResponse = await readPublicPayLink(publicRequest, link.slug, { headers: accessHeaders })
        expect(publicResponse.status()).toBe(200)
        expectPublicPayload(await readJsonSafe(publicResponse), link.id, false)

        const previewResponse = await apiRequest(request, 'GET', `/api/checkout/pay/${link.slug}?preview=true`, { token })
        expect(previewResponse.status()).toBe(200)
        expectPublicPayload(await readJsonSafe(previewResponse), link.id, true)
      } finally {
        await publicRequest.dispose()
        await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
      }
    })
  }
})
