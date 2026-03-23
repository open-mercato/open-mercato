import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createFixedTemplateInput,
  createTemplateFixture,
  deleteCheckoutEntityIfExists,
  deleteTemplate,
  listTemplates,
} from './helpers/fixtures'

test.describe('TC-CHKT-003: Delete template, verify soft delete', () => {
  test('soft deletes the template so it no longer appears in the list', async ({ request }) => {
    let token: string | null = null
    let templateId: string | null = null

    try {
      token = await getAuthToken(request)
      const input = createFixedTemplateInput()
      templateId = await createTemplateFixture(request, token, input)

      const response = await deleteTemplate(request, token, templateId)
      expect(response.ok()).toBeTruthy()

      const list = await listTemplates(request, token, `search=${encodeURIComponent(input.name)}`)
      expect(list.items.find((item) => item.id === templateId)).toBeFalsy()

      templateId = null
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'templates', templateId)
    }
  })
})
