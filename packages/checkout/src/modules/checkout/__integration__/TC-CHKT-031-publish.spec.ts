import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createFixedTemplateInput,
  createLinkFixture,
  deleteCheckoutEntityIfExists,
  readPublicPayLink,
  updateLink,
} from './helpers/fixtures'

test.describe('TC-CHKT-031 (publish): Publish draft link makes it publicly accessible', () => {
  test('exposes the link through the public pay endpoint after the status changes to active', async ({ request }) => {
    let token: string | null = null
    let linkId: string | null = null

    try {
      token = await getAuthToken(request)
      const link = await createLinkFixture(request, token, {
        ...createFixedTemplateInput({ status: 'draft' }),
      })
      linkId = link.id

      const beforePublish = await readPublicPayLink(request, link.slug)
      expect(beforePublish.status()).toBe(404)

      const publishResponse = await updateLink(request, token, link.id, {
        status: 'active',
      })
      expect(publishResponse.ok()).toBeTruthy()

      const afterPublish = await readPublicPayLink(request, link.slug)
      expect(afterPublish.status()).toBe(200)
      expect(await afterPublish.json()).toMatchObject({
        slug: link.slug,
        preview: false,
      })
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })
})
