import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createCategoryFixture, deleteCatalogCategoryIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { deleteTranslationIfExists, getLocales, setLocales } from './helpers/translationFixtures'

const ENTITY_TYPE = 'catalog:catalog_product_category'

/**
 * TC-TRANS-007: Dynamic Widget Injection on Category Edit
 * Verifies that the Translation Manager widget auto-injects on entity types
 * beyond catalog products. Since injection-table.ts now dynamically generates
 * entries for ALL translatable entity types, this test confirms the mechanism
 * works for product categories (a second CrudForm-based entity).
 */
test.describe('TC-TRANS-007: Dynamic Widget Injection on Category Edit', () => {
  test.use({ actionTimeout: 30_000 })

  test('should show translation widget on category edit page', async ({ page, request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const originalLocales = await getLocales(request, adminToken)
    const categoryName = `QA TC-TRANS-007-1 ${Date.now()}`
    let categoryId: string | null = null

    try {
      await setLocales(request, adminToken, [...new Set([...originalLocales, 'de'])])
      categoryId = await createCategoryFixture(request, adminToken, { name: categoryName })

      await login(page, 'superadmin')
      await page.goto(`/backend/catalog/categories/${categoryId}/edit`)

      await expect(page.getByRole('link', { name: /Translation manager/ })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Save translations' })).toBeVisible()
    } finally {
      await deleteCatalogCategoryIfExists(request, adminToken, categoryId)
      await setLocales(request, adminToken, originalLocales).catch(() => {})
    }
  })

  test('should save a translation via the category widget and verify via API', async ({ page, request }) => {
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

      const widgetSection = page.locator('div').filter({
        has: page.getByRole('link', { name: /Translation manager/ }),
      }).filter({
        has: page.getByRole('button', { name: 'Save translations' }),
      }).last()
      await expect(widgetSection).toBeVisible()

      const deTab = widgetSection.getByRole('button', { name: 'DE' })
      await deTab.click()

      const translationInput = widgetSection.locator('table input').first()
      await translationInput.fill('Kategorie QA')

      await widgetSection.getByRole('button', { name: 'Save translations' }).click()
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
