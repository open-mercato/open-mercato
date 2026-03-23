import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createFixedTemplateInput,
  createTemplateFixture,
  deleteCheckoutEntityIfExists,
  listTemplates,
} from './helpers/fixtures'

test.describe('TC-CHKT-001: Create template, verify in list', () => {
  test('creates a template and returns it in the templates list', async ({ request }) => {
    let token: string | null = null
    let templateId: string | null = null

    try {
      token = await getAuthToken(request)
      const input = createFixedTemplateInput()

      templateId = await createTemplateFixture(request, token, input)

      const list = await listTemplates(request, token, `search=${encodeURIComponent(input.name)}`)
      const created = list.items.find((item) => item.id === templateId)

      expect(created).toBeTruthy()
      expect(created?.name).toBe(input.name)
      expect(created?.pricingMode).toBe('fixed')
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'templates', templateId)
    }
  })
})
