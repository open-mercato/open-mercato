import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  deleteAttachmentIfExists,
  uploadAttachmentFixture,
} from '@open-mercato/core/modules/core/__integration__/helpers/attachmentsFixtures'
import {
  createCheckoutClientHeaders,
  createFixedTemplateInput,
  createLinkFixture,
  createTemplateFixture,
  deleteCheckoutEntityIfExists,
  readPublicPayLink,
  updateLink,
  updateTemplate,
} from './helpers/fixtures'

/**
 * TC-CHKT-044: the pay page's logo loads for an anonymous visitor.
 *
 * The public pay payload used to point `logoPreviewUrl` at
 * `/api/attachments/image/{id}`, which refuses every anonymous read of a
 * tenant-scoped attachment (401), so an uploaded logo never rendered on a
 * published pay page. The logo is now served by `/api/checkout/pay/{slug}/logo`,
 * gated like the pay page and read by owner through the attachments service.
 */

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

async function fetchAnonymously(request: APIRequestContext, path: string) {
  return request.fetch(`${BASE_URL}${path}`, { method: 'GET', headers: createCheckoutClientHeaders() })
}

async function readLogoUrl(request: APIRequestContext, slug: string): Promise<string> {
  const response = await readPublicPayLink(request, slug)
  expect(response.status()).toBe(200)
  const payload = await readJsonSafe<{ logoPreviewUrl?: string | null }>(response)
  expect(typeof payload?.logoPreviewUrl).toBe('string')
  return payload!.logoPreviewUrl!
}

test.describe('TC-CHKT-044: public pay link logo', () => {
  test('serves a link logo and a template-inherited logo to anonymous visitors, and nothing else', async ({ request }) => {
    const token = await getAuthToken(request)
    const attachmentIds: string[] = []
    const linkIds: string[] = []
    let templateId: string | null = null

    try {
      const ownLink = await createLinkFixture(request, token, createFixedTemplateInput({ status: 'active' }))
      linkIds.push(ownLink.id)
      const ownLogo = await uploadAttachmentFixture(request, token, {
        entityId: 'checkout:checkout_link',
        recordId: ownLink.id,
        fileName: 'logo.png',
        mimeType: 'image/png',
        buffer: PNG,
      })
      attachmentIds.push(ownLogo.id)
      expect((await updateLink(request, token, ownLink.id, { logoAttachmentId: ownLogo.id })).ok()).toBeTruthy()

      const ownLogoUrl = await readLogoUrl(request, ownLink.slug)
      expect(ownLogoUrl).toBe(`/api/checkout/pay/${encodeURIComponent(ownLink.slug)}/logo`)
      const ownLogoResponse = await fetchAnonymously(request, ownLogoUrl)
      expect(ownLogoResponse.status()).toBe(200)
      expect(ownLogoResponse.headers()['content-type']).toBe('image/png')
      expect(Buffer.from(await ownLogoResponse.body())).toEqual(PNG)

      const legacyImageRoute = await fetchAnonymously(request, `/api/attachments/image/${encodeURIComponent(ownLogo.id)}`)
      expect(legacyImageRoute.status()).toBe(401)

      templateId = await createTemplateFixture(request, token, createFixedTemplateInput())
      const templateLogo = await uploadAttachmentFixture(request, token, {
        entityId: 'checkout:checkout_link_template',
        recordId: templateId,
        fileName: 'template-logo.png',
        mimeType: 'image/png',
        buffer: PNG,
      })
      attachmentIds.push(templateLogo.id)
      expect((await updateTemplate(request, token, templateId, { logoAttachmentId: templateLogo.id })).ok()).toBeTruthy()
      const inheritingLink = await createLinkFixture(request, token, createFixedTemplateInput({ templateId, status: 'active' }))
      linkIds.push(inheritingLink.id)
      const inheritedResponse = await fetchAnonymously(request, await readLogoUrl(request, inheritingLink.slug))
      expect(inheritedResponse.status()).toBe(200)
      expect(inheritedResponse.headers()['content-type']).toBe('image/png')

      const borrowingLink = await createLinkFixture(request, token, createFixedTemplateInput({ status: 'active' }))
      linkIds.push(borrowingLink.id)
      expect((await updateLink(request, token, borrowingLink.id, { logoAttachmentId: ownLogo.id })).ok()).toBeTruthy()
      const borrowedResponse = await fetchAnonymously(request, `/api/checkout/pay/${encodeURIComponent(borrowingLink.slug)}/logo`)
      expect(borrowedResponse.status()).toBe(404)

      expect((await updateLink(request, token, ownLink.id, { status: 'draft' })).ok()).toBeTruthy()
      const unpublishedResponse = await fetchAnonymously(request, `/api/checkout/pay/${encodeURIComponent(ownLink.slug)}/logo`)
      expect(unpublishedResponse.status()).toBe(404)
    } finally {
      for (const linkId of linkIds) await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
      await deleteCheckoutEntityIfExists(request, token, 'templates', templateId)
      for (const attachmentId of attachmentIds) await deleteAttachmentIfExists(request, token, attachmentId)
    }
  })
})
