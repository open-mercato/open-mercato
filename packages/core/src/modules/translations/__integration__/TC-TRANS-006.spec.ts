import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { deleteTranslationIfExists, getLocales, setLocales } from './helpers/translationFixtures'

const ENTITY_TYPE = 'catalog:catalog_product'

/**
 * TC-TRANS-006: Embedded Widget on Product Detail
 * Covers the translation widget injected on the catalog product edit page.
 */
test.describe('TC-TRANS-006: Embedded Widget on Product Detail', () => {
  test.use({ actionTimeout: 30_000 })
  test('should show translation widget on product edit page', async ({ page, request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const originalLocales = await getLocales(request, adminToken)
    const productTitle = `QA TC-TRANS-006-1 ${Date.now()}`
    const sku = `QA-TRANS-006-1-${Date.now()}`
    let productId: string | null = null

    try {
      await setLocales(request, adminToken, [...new Set([...originalLocales, 'de'])])
      productId = await createProductFixture(request, adminToken, { title: productTitle, sku })

      await login(page, 'superadmin')
      await page.goto(`/backend/catalog/products/${productId}`)

      await expect(page.getByRole('link', { name: /Translation manager/ })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Save translations' })).toBeVisible()
    } finally {
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await setLocales(request, adminToken, originalLocales).catch(() => {})
    }
  })

  test('should enter and save a translation in the embedded widget', async ({ page, request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const saToken = await getAuthToken(request, 'superadmin')
    const originalLocales = await getLocales(request, adminToken)
    const productTitle = `QA TC-TRANS-006-2 ${Date.now()}`
    const sku = `QA-TRANS-006-2-${Date.now()}`
    let productId: string | null = null

    try {
      await setLocales(request, adminToken, [...new Set([...originalLocales, 'de'])])
      productId = await createProductFixture(request, adminToken, { title: productTitle, sku })

      await login(page, 'superadmin')
      await page.goto(`/backend/catalog/products/${productId}`)

      const widgetSection = page.locator('div').filter({
        has: page.getByRole('link', { name: /Translation manager/ }),
      }).filter({
        has: page.getByRole('button', { name: 'Save translations' }),
      }).last()
      await expect(widgetSection).toBeVisible()

      const deTab = widgetSection.getByRole('button', { name: 'DE' })
      await deTab.click()

      const translationInput = widgetSection.locator('table input').first()
      await translationInput.fill('Widget Titel QA')

      await widgetSection.getByRole('button', { name: 'Save translations' }).click()
      await expect(page.getByText('Translations saved').first()).toBeVisible()
    } finally {
      await deleteTranslationIfExists(request, saToken, ENTITY_TYPE, productId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await setLocales(request, adminToken, originalLocales).catch(() => {})
    }
  })

  test('should verify widget-saved translation via API', async ({ page, request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const saToken = await getAuthToken(request, 'superadmin')
    const originalLocales = await getLocales(request, adminToken)
    const productTitle = `QA TC-TRANS-006-3 ${Date.now()}`
    const sku = `QA-TRANS-006-3-${Date.now()}`
    let productId: string | null = null

    try {
      await setLocales(request, adminToken, [...new Set([...originalLocales, 'de'])])
      productId = await createProductFixture(request, adminToken, { title: productTitle, sku })

      await login(page, 'superadmin')
      await page.goto(`/backend/catalog/products/${productId}`)

      const widgetSection = page.locator('div').filter({
        has: page.getByRole('link', { name: /Translation manager/ }),
      }).filter({
        has: page.getByRole('button', { name: 'Save translations' }),
      }).last()
      const deTab = widgetSection.getByRole('button', { name: 'DE' })
      await deTab.click()

      const translationInput = widgetSection.locator('table input').first()
      await translationInput.fill('API Verifiziert QA')

      await widgetSection.getByRole('button', { name: 'Save translations' }).click()
      await expect(page.getByText('Translations saved').first()).toBeVisible()

      const getResponse = await apiRequest(request, 'GET', `/api/translations/${ENTITY_TYPE}/${productId}`, { token: saToken })
      expect(getResponse.ok()).toBeTruthy()
      const body = (await getResponse.json()) as { translations: Record<string, Record<string, string>> }
      expect(body.translations.de.title).toBe('API Verifiziert QA')
    } finally {
      await deleteTranslationIfExists(request, saToken, ENTITY_TYPE, productId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await setLocales(request, adminToken, originalLocales).catch(() => {})
    }
  })
})
