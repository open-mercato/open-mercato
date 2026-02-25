import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'

test.describe('TC-UMES-001: Foundation and Menu Injection', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin')
    await page.goto('/backend')
  })

  test('should render injected sidebar item and navigate to todos page', async ({ page }) => {
    const sidebarItem = page.locator('[data-menu-item-id="example-todos-shortcut"]').first()
    await expect(sidebarItem).toBeVisible()
    await sidebarItem.click()
    await expect(page).toHaveURL(/\/backend\/todos(?:\?.*)?$/)
  })
})
