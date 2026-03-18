import { expect, test, type Locator, type Page } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'

async function openTranslationsDrawer(page: Page): Promise<Locator> {
  const openButton = page.getByRole('button', { name: /Translation manager/i }).first()
  const dialog = page.getByRole('dialog', { name: /Translations/i })

  await expect(openButton).toBeVisible()
  await expect(openButton).toBeEnabled()
  await openButton.click()
  await expect(dialog).toBeVisible()

  return dialog
}

/**
 * TC-TRANS-010: Drawer Escape Close and Body Scroll Restore
 * Verifies that translation drawer closes on Escape and restores body overflow style.
 */
test.describe('TC-TRANS-010: Drawer Escape Close and Body Scroll Restore', () => {
  test('should close drawer on Escape and restore body overflow', async ({ page, request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const productTitle = `QA TC-TRANS-010 ${Date.now()}`
    const sku = `QA-TRANS-010-${Date.now()}`
    let productId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, { title: productTitle, sku })

      await login(page, 'superadmin')
      await page.goto(`/backend/catalog/products/${productId}`)

      const dialog = await openTranslationsDrawer(page)

      await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden')
      await expect(dialog).toBeVisible()

      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
    } finally {
      await deleteCatalogProductIfExists(request, adminToken, productId)
    }
  })
})
