import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createFixedTemplateInput,
  createLinkFixture,
  deleteCheckoutEntityIfExists,
} from './helpers/fixtures'

test.describe('TC-CHKT-006: Slug auto-generation and uniqueness', () => {
  test('generates a unique slug when the requested slug already exists', async ({ request }) => {
    let token: string | null = null
    let firstLinkId: string | null = null
    let secondLinkId: string | null = null

    try {
      token = await getAuthToken(request)
      const sharedSlug = `qa-checkout-slug-${Date.now()}`

      const first = await createLinkFixture(request, token, {
        ...createFixedTemplateInput({ status: 'draft' }),
        slug: sharedSlug,
      })
      firstLinkId = first.id

      const second = await createLinkFixture(request, token, {
        ...createFixedTemplateInput({ status: 'draft' }),
        slug: sharedSlug,
      })
      secondLinkId = second.id

      expect(first.slug).toBe(sharedSlug)
      expect(second.slug).not.toBe(sharedSlug)
      expect(second.slug.startsWith(sharedSlug)).toBeTruthy()
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', firstLinkId)
      await deleteCheckoutEntityIfExists(request, token, 'links', secondLinkId)
    }
  })
})
