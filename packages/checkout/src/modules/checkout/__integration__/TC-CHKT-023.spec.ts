import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createFixedTemplateInput,
  createLinkFixture,
  deleteCheckoutEntityIfExists,
  readPublicPayLink,
} from './helpers/fixtures'

test.describe('TC-CHKT-023: Draft/inactive link returns 404 on public page', () => {
  test('does not expose draft or inactive links through the public pay endpoint', async ({ request }) => {
    let token: string | null = null
    let draftLinkId: string | null = null
    let inactiveLinkId: string | null = null

    try {
      token = await getAuthToken(request)
      const draftLink = await createLinkFixture(request, token, {
        ...createFixedTemplateInput({ status: 'draft' }),
      })
      const inactiveLink = await createLinkFixture(request, token, {
        ...createFixedTemplateInput({ status: 'inactive' }),
      })
      draftLinkId = draftLink.id
      inactiveLinkId = inactiveLink.id

      const draftResponse = await readPublicPayLink(request, draftLink.slug)
      const inactiveResponse = await readPublicPayLink(request, inactiveLink.slug)

      expect(draftResponse.status()).toBe(404)
      expect(inactiveResponse.status()).toBe(404)
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', draftLinkId)
      await deleteCheckoutEntityIfExists(request, token, 'links', inactiveLinkId)
    }
  })
})
