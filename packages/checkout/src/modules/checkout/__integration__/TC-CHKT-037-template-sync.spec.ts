import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createFixedTemplateInput,
  createLinkFixture,
  createTemplateFixture,
  deleteCheckoutEntityIfExists,
  readLink,
  updateTemplate,
} from './helpers/fixtures'

test.describe('TC-CHKT-037: Template updates sync unchanged fields to existing links', () => {
  test('updates inherited fields while preserving link-specific overrides', async ({ request }) => {
    let token: string | null = null
    let templateId: string | null = null
    let linkId: string | null = null

    try {
      token = await getAuthToken(request)
      templateId = await createTemplateFixture(request, token, createFixedTemplateInput({
        title: 'Template title v1',
        subtitle: 'Template subtitle v1',
      }))

      const link = await createLinkFixture(request, token, {
        name: 'Template sync link',
        templateId,
        title: 'Manual link title',
        slug: 'qa-template-sync-link',
        pricingMode: 'fixed',
        fixedPriceAmount: 49.99,
        fixedPriceCurrencyCode: 'USD',
        gatewayProviderKey: 'mock',
        status: 'draft',
      })
      linkId = link.id

      const updateResponse = await updateTemplate(request, token, templateId, {
        title: 'Template title v2',
        subtitle: 'Template subtitle v2',
      })
      expect(updateResponse.ok(), `Template update failed: ${updateResponse.status()}`).toBeTruthy()

      const stored = await readLink(request, token, link.id)
      expect(stored.title).toBe('Manual link title')
      expect(stored.subtitle).toBe('Template subtitle v2')
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
      await deleteCheckoutEntityIfExists(request, token, 'templates', templateId)
    }
  })
})
