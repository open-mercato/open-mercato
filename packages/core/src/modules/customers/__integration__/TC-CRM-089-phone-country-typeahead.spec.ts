import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

test.describe('TC-CRM-089: Phone country picker supports type-to-find', () => {
  test('typing a country name prefix jumps to and selects the matching country', async ({ page }) => {
    await login(page, 'admin')
    await page.goto('/backend/customers/people/create')

    const trigger = page.getByRole('combobox', { name: 'Country code' }).first()
    await trigger.click()
    await expect(page.getByRole('listbox')).toBeVisible()

    await page.keyboard.type('po')
    await expect(page.locator('[role="option"][data-highlighted]')).toContainText('Poland')

    await page.keyboard.press('Enter')
    await expect(page.getByRole('listbox')).toBeHidden()
    await expect(trigger).toContainText('+48')
  })
})
