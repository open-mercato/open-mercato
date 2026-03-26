import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createFixedTemplateInput,
  createLinkFixture,
  createTemplateFixture,
  deleteCheckoutEntityIfExists,
  readLink,
} from './helpers/fixtures'

test.describe('TC-CHKT-004: Create link from template, verify field copy', () => {
  test('copies template fields into the new link when templateId is provided', async ({ request }) => {
    let token: string | null = null
    let templateId: string | null = null
    let linkId: string | null = null

    try {
      token = await getAuthToken(request)
      const templateInput = createFixedTemplateInput({
        title: 'QA copied title',
        subtitle: 'QA copied subtitle',
        displayCustomFieldsOnPage: true,
      })
      templateId = await createTemplateFixture(request, token, templateInput)

      const link = await createLinkFixture(request, token, {
        name: 'QA link from template',
        templateId,
        title: 'QA override title',
        slug: 'qa-template-link',
        pricingMode: 'fixed',
        fixedPriceAmount: 49.99,
        fixedPriceCurrencyCode: 'USD',
        gatewayProviderKey: 'mock',
        status: 'draft',
      })
      linkId = link.id

      const stored = await readLink(request, token, link.id)
      expect(stored.templateId).toBe(templateId)
      expect(stored.title).toBe('QA override title')
      expect(stored.subtitle).toBe('QA copied subtitle')
      expect(stored.displayCustomFieldsOnPage).toBe(true)
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
      await deleteCheckoutEntityIfExists(request, token, 'templates', templateId)
    }
  })
})
