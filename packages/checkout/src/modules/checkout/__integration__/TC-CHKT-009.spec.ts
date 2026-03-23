import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createFixedTemplateInput,
  createLinkFixture,
  deleteCheckoutEntityIfExists,
  readPublicPayLink,
} from './helpers/fixtures'

test.describe('TC-CHKT-009: Public pay page load', () => {
  test('returns the active public pay-link payload without secrets', async ({ request }) => {
    let token: string | null = null
    let linkId: string | null = null

    try {
      token = await getAuthToken(request)
      const link = await createLinkFixture(request, token, {
        ...createFixedTemplateInput({ status: 'active' }),
      })
      linkId = link.id

      const response = await readPublicPayLink(request, link.slug)
      expect(response.ok()).toBeTruthy()

      const body = await response.json()
      expect(body.requiresPassword).toBe(false)
      expect(body.slug).toBe(link.slug)
      expect(body.gatewaySettings).toBeUndefined()
      expect(body.passwordHash).toBeUndefined()
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })
})
