import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createFixedTemplateInput,
  createLinkFixture,
  deleteCheckoutEntityIfExists,
  readLink,
} from './helpers/fixtures'

test.describe('TC-CHKT-005: Create link without template', () => {
  test('creates a standalone link with a generated slug', async ({ request }) => {
    let token: string | null = null
    let linkId: string | null = null

    try {
      token = await getAuthToken(request)
      const link = await createLinkFixture(request, token, {
        ...createFixedTemplateInput({
          status: 'draft',
        }),
        slug: null,
      })
      linkId = link.id

      const stored = await readLink(request, token, link.id)
      expect(stored.id).toBe(link.id)
      expect(stored.slug).toBe(link.slug)
      expect(stored.templateId).toBeNull()
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })
})
