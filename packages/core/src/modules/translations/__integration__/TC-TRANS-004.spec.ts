import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getLocales, setLocales } from './helpers/translationFixtures'

/**
 * TC-TRANS-004: Locale Management Page
 * Covers navigation to translations config, adding and removing locales via the UI.
 */
test.describe('TC-TRANS-004: Locale Management Page', () => {
  test('should navigate to translations config page', async ({ page }) => {
    await login(page, 'superadmin')
    await page.goto('/backend/config/translations')

    await expect(page.getByText('Supported locales')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Translations' })).toBeVisible()
  })

  test('should add a locale via UI and verify via API', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const originalLocales = await getLocales(request, token)

    try {
      await login(page, 'superadmin')
      await page.goto('/backend/config/translations')
      await expect(page.getByText('Supported locales')).toBeVisible()

      const searchInput = page.getByPlaceholder('e.g. fr, it, ja...')
      await searchInput.fill('Japanese')
      await page.getByText(/JA — Japanese/i).click()
      await page.getByRole('button', { name: 'Add' }).click()

      await expect(page.locator('span').filter({ hasText: /^JA/ })).toBeVisible()

      const updatedLocales = await getLocales(request, token)
      expect(updatedLocales).toContain('ja')
    } finally {
      await setLocales(request, token, originalLocales).catch(() => {})
    }
  })

  test('should remove a locale via UI and verify via API', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const originalLocales = await getLocales(request, token)

    try {
      await setLocales(request, token, [...new Set([...originalLocales, 'ja'])])

      await login(page, 'superadmin')
      await page.goto('/backend/config/translations')
      await expect(page.getByText('Supported locales')).toBeVisible()

      const jaBadge = page.locator('span').filter({ hasText: /^JA/ })
      await expect(jaBadge).toBeVisible()
      const removeButton = jaBadge.getByRole('button')
      await removeButton.click()

      await expect(jaBadge).not.toBeVisible()

      const updatedLocales = await getLocales(request, token)
      expect(updatedLocales).not.toContain('ja')
    } finally {
      await setLocales(request, token, originalLocales).catch(() => {})
    }
  })
})
