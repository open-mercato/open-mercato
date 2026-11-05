import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createFixedTemplateInput,
  createLinkFixture,
  deleteCheckoutEntityIfExists,
  updateLink,
} from './helpers/fixtures'

test.describe('TC-CHKT-029 (currency): Link create/update rejects currency unsupported by selected gateway provider', () => {
  test('returns validation errors when the provider does not support the configured checkout currency', async ({ request }) => {
    let token: string | null = null
    let linkId: string | null = null

    try {
      token = await getAuthToken(request)

      const createResponse = await request.fetch(`${process.env.BASE_URL || 'http://localhost:3000'}/api/checkout/links`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        data: createFixedTemplateInput({
          status: 'draft',
          gatewayProviderKey: 'mock_usd',
          fixedPriceCurrencyCode: 'EUR',
        }),
      })
      expect(createResponse.status()).toBe(422)
      expect(await createResponse.json()).toMatchObject({
        error: expect.stringContaining('Unsupported currency'),
      })

      const link = await createLinkFixture(request, token, {
        ...createFixedTemplateInput({
          status: 'draft',
          gatewayProviderKey: 'mock_usd',
          fixedPriceCurrencyCode: 'USD',
        }),
      })
      linkId = link.id

      const updateResponse = await updateLink(request, token, link.id, {
        fixedPriceCurrencyCode: 'EUR',
      })
      expect(updateResponse.status()).toBe(422)
      expect(await updateResponse.json()).toMatchObject({
        error: expect.stringContaining('Unsupported currency'),
      })
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })
})
