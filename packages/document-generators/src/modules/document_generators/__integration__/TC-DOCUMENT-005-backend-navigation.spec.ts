import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

test.describe('TC-DOCUMENT-005: backend navigation', () => {
  test('root redirects to Overview and the cards reach Templates and History', async ({ page }) => {
    test.setTimeout(90_000)
    await login(page, 'admin')
    await page.goto('/backend/document-generators', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/backend\/document-generators\/overview$/, { timeout: 20_000 })

    await page.locator('a[href="/backend/document-generators/templates"]').first().click()
    await expect(page).toHaveURL(/\/backend\/document-generators\/templates$/, { timeout: 20_000 })
    await expect(page.getByRole('heading', { name: 'Document templates' })).toBeVisible({ timeout: 20_000 })

    await page.goto('/backend/document-generators/overview', { waitUntil: 'domcontentloaded' })
    await page.locator('a[href="/backend/document-generators/history"]').first().click()
    await expect(page).toHaveURL(/\/backend\/document-generators\/history$/, { timeout: 20_000 })
    await expect(page.getByRole('heading', { name: 'Generation history' })).toBeVisible({ timeout: 20_000 })
  })
})
