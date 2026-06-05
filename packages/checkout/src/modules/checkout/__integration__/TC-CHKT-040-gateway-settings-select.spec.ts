import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  createFixedTemplateInput,
  createTemplateFixture,
  deleteCheckoutEntityIfExists,
  readTemplate,
} from './helpers/fixtures'

test.describe('TC-CHKT-040: Gateway setting selects round-trip through template edit UI', () => {
  test('prefills and saves the checkout capture method', async ({ page, request }) => {
    test.slow()
    let token: string | null = null
    let templateId: string | null = null

    try {
      token = await getAuthToken(request)
      templateId = await createTemplateFixture(request, token, createFixedTemplateInput({
        gatewayProviderKey: 'mock_processing',
        gatewaySettings: { captureMethod: 'manual' },
        status: 'draft',
      }))

      await login(page, 'admin')
      await page.goto(`/backend/checkout/templates/${encodeURIComponent(templateId)}`, { waitUntil: 'commit' })

      await expect(page.locator('main').getByText('Edit Template').first()).toBeVisible()
      const captureMethodField = page.getByText('Capture method').locator('xpath=ancestor::div[contains(@class, "space-y-2")]').first()
      const captureMethodSelect = captureMethodField.getByRole('combobox').first()
      await expect(captureMethodSelect).toBeVisible()
      await expect(captureMethodSelect).toContainText('Manual capture')

      await captureMethodSelect.click()
      await page.getByRole('option', { name: 'Automatic capture' }).click()
      await page.locator('form').getByRole('button', { name: 'Save' }).click()
      await expect(page).toHaveURL(/\/backend\/checkout\/templates(?:\?.*)?$/)

      const saved = await readTemplate(request, token, templateId)
      expect((saved.gatewaySettings as Record<string, unknown> | undefined)?.captureMethod).toBe('automatic')
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'templates', templateId)
    }
  })
})
