import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createFixedTemplateInput,
  createLinkFixture,
  deleteCheckoutEntityIfExists,
  updateLink,
} from './helpers/fixtures'

test.describe('TC-CHKT-032 (publish): Publish requires gateway provider', () => {
  test('fails validation when a publish attempt clears the configured gateway provider', async ({ request }) => {
    let token: string | null = null
    let linkId: string | null = null

    try {
      token = await getAuthToken(request)
      const link = await createLinkFixture(request, token, {
        ...createFixedTemplateInput({ status: 'draft' }),
      })
      linkId = link.id

      const response = await updateLink(request, token, link.id, {
        status: 'active',
        gatewayProviderKey: '',
      })
      expect([400, 422]).toContain(response.status())

      const body = await response.json()
      const fieldError = typeof body.fieldErrors?.gatewayProviderKey === 'string'
        ? body.fieldErrors.gatewayProviderKey
        : ''
      const errorMessage = typeof body.error === 'string' ? body.error : ''
      expect(`${fieldError} ${errorMessage}`.toLowerCase()).toContain('gateway')
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })
})
