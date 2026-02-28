import { expect, test, type Locator, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createCategoryFixture, deleteCatalogCategoryIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { deleteTranslationIfExists, getLocales, setLocales } from './helpers/translationFixtures'

const ENTITY_TYPE = 'catalog:catalog_product_category'

async function openTranslationsDrawer(page: Page): Promise<Locator> {
  const openButton = page.getByRole('button', { name: /Translation manager/ }).first()
  const dialog = page.getByRole('dialog', { name: /Translations/i })

  await expect(openButton).toBeVisible()
  await expect(openButton).toBeEnabled()
  await openButton.click()
  await expect(dialog).toBeVisible()
  return dialog
}

async function waitForTranslationField(dialog: Locator, preferredPlaceholder?: string): Promise<Locator> {
  const firstEditableField = dialog.locator('table').locator('input, textarea').first()
  await expect(firstEditableField).toBeVisible()

  const normalizedPlaceholder = preferredPlaceholder?.trim()
  if (!normalizedPlaceholder) return firstEditableField

  const preferredField = dialog.getByPlaceholder(normalizedPlaceholder).first()
  if (await preferredField.count()) {
    await expect(preferredField).toBeVisible()
    return preferredField
  }

  return firstEditableField
}

/**
 * TC-TRANS-007: Dynamic Header Action Injection on Category Edit
 * Verifies that the Translation Manager action auto-injects on entity types
 * beyond catalog products. Since injection-table.ts now dynamically generates
 * entries for all translatable entity types, this test confirms the mechanism
 * works for product categories.
 */
test.describe('TC-TRANS-007: Dynamic Header Action Injection on Category Edit', () => {
  test.use({ actionTimeout: 30_000 })

  test('should show translation action on category edit page', async ({ page, request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const originalLocales = await getLocales(request, adminToken)
    const categoryName = `QA TC-TRANS-007-1 ${Date.now()}`
    let categoryId: string | null = null

    try {
      await setLocales(request, adminToken, [...new Set([...originalLocales, 'de'])])
      categoryId = await createCategoryFixture(request, adminToken, { name: categoryName })

      await login(page, 'superadmin')
      await page.goto(`/backend/catalog/categories/${categoryId}/edit`)

      const dialog = await openTranslationsDrawer(page)
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Save translations' })).toBeVisible()
    } finally {
      await deleteCatalogCategoryIfExists(request, adminToken, categoryId)
      await setLocales(request, adminToken, originalLocales).catch(() => {})
    }
  })

  test('should save a translation via the category drawer and verify via API', async ({ page, request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const saToken = await getAuthToken(request, 'superadmin')
    const originalLocales = await getLocales(request, adminToken)
    const categoryName = `QA TC-TRANS-007-2 ${Date.now()}`
    let categoryId: string | null = null

    try {
      await setLocales(request, adminToken, [...new Set([...originalLocales, 'de'])])
      categoryId = await createCategoryFixture(request, adminToken, { name: categoryName })

      await login(page, 'superadmin')
      await page.goto(`/backend/catalog/categories/${categoryId}/edit`)

      const dialog = await openTranslationsDrawer(page)
      await expect(dialog).toBeVisible()

      const deTab = dialog.getByRole('button', { name: 'DE' })
      await deTab.click()

      const translationField = await waitForTranslationField(dialog, categoryName)
      await translationField.fill('Kategorie QA')

      const saveTranslationsButton = dialog.getByRole('button', { name: 'Save translations' })
      await expect(saveTranslationsButton).toBeVisible()
      await saveTranslationsButton.click()
      await expect(page.getByText('Translations saved').first()).toBeVisible()

      const getResponse = await apiRequest(request, 'GET', `/api/translations/${ENTITY_TYPE}/${categoryId}`, { token: saToken })
      expect(getResponse.ok()).toBeTruthy()
      const body = (await getResponse.json()) as { translations: Record<string, Record<string, string>> }
      expect(body.translations.de.name).toBe('Kategorie QA')
    } finally {
      await deleteTranslationIfExists(request, saToken, ENTITY_TYPE, categoryId)
      await deleteCatalogCategoryIfExists(request, adminToken, categoryId)
      await setLocales(request, adminToken, originalLocales).catch(() => {})
    }
  })
})
