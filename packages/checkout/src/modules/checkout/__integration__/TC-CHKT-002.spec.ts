import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createFixedTemplateInput,
  createTemplateFixture,
  deleteCheckoutEntityIfExists,
  readTemplate,
  updateTemplate,
} from './helpers/fixtures'

test.describe('TC-CHKT-002: Update template, verify changes', () => {
  test('updates template fields and persists the new values', async ({ request }) => {
    let token: string | null = null
    let templateId: string | null = null

    try {
      token = await getAuthToken(request)
      templateId = await createTemplateFixture(request, token, createFixedTemplateInput())

      const response = await updateTemplate(request, token, templateId, {
        name: 'QA updated template',
        title: 'QA updated title',
        fixedPriceAmount: 88.5,
      })
      expect(response.ok()).toBeTruthy()

      const updated = await readTemplate(request, token, templateId)
      expect(updated.name).toBe('QA updated template')
      expect(updated.title).toBe('QA updated title')
      expect(updated.fixedPriceAmount).toBe(88.5)
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'templates', templateId)
    }
  })
})
