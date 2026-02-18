import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { deleteTranslationIfExists, getLocales, setLocales } from './helpers/translationFixtures'

const ENTITY_TYPE = 'catalog:catalog_product'

/**
 * TC-TRANS-005: Translation Manager Standalone
 * Covers selecting entity/record, entering translations, saving, and verifying persistence.
 */
test.describe('TC-TRANS-005: Translation Manager Standalone', () => {
  test('should select entity type and record, showing the field table', async ({ page, request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const saToken = await getAuthToken(request, 'superadmin')
    const originalLocales = await getLocales(request, adminToken)
    const productTitle = `QA TC-TRANS-005-1 ${Date.now()}`
    const sku = `QA-TRANS-005-1-${Date.now()}`
    let productId: string | null = null

    try {
      await setLocales(request, adminToken, [...new Set([...originalLocales, 'de'])])
      productId = await createProductFixture(request, adminToken, { title: productTitle, sku })

      await login(page, 'superadmin')
      await page.goto('/backend/config/translations')
      await expect(page.getByRole('heading', { name: 'Translations' })).toBeVisible()

      const entityInput = page.getByPlaceholder('Select an entity')
      await entityInput.fill('catalog_product')
      await page.locator('.absolute.z-50 button').filter({ hasText: /catalog_product/i }).first().click()

      const recordInput = page.getByPlaceholder('Search records...')
      await recordInput.fill(productTitle)
      await page.locator('.absolute.z-50 button').filter({ hasText: productTitle }).first().click()

      await expect(page.getByText('Field')).toBeVisible()
      await expect(page.getByText('Base value')).toBeVisible()
    } finally {
      await deleteTranslationIfExists(request, saToken, ENTITY_TYPE, productId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await setLocales(request, adminToken, originalLocales).catch(() => {})
    }
  })

  test('should enter and save a translation via standalone manager', async ({ page, request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const saToken = await getAuthToken(request, 'superadmin')
    const originalLocales = await getLocales(request, adminToken)
    const productTitle = `QA TC-TRANS-005-2 ${Date.now()}`
    const sku = `QA-TRANS-005-2-${Date.now()}`
    let productId: string | null = null

    try {
      await setLocales(request, adminToken, [...new Set([...originalLocales, 'de'])])
      productId = await createProductFixture(request, adminToken, { title: productTitle, sku })

      await login(page, 'superadmin')
      await page.goto('/backend/config/translations')

      const entityInput = page.getByPlaceholder('Select an entity')
      await entityInput.fill('catalog_product')
      await page.locator('.absolute.z-50 button').filter({ hasText: /catalog_product/i }).first().click()

      const recordInput = page.getByPlaceholder('Search records...')
      await recordInput.fill(productTitle)
      await page.locator('.absolute.z-50 button').filter({ hasText: productTitle }).first().click()

      await expect(page.getByText('Field')).toBeVisible()

      const managerCard = page.locator('.bg-card').filter({
        has: page.getByRole('button', { name: 'Save translations' }),
      })
      const deTab = managerCard.getByRole('button', { name: 'DE' })
      await deTab.click()

      const titleInput = page.locator('table input').first()
      await titleInput.fill('Deutscher Titel QA')

      await page.getByRole('button', { name: 'Save translations' }).click()
      await expect(page.getByText('Translations saved').first()).toBeVisible()

      const getResponse = await apiRequest(request, 'GET', `/api/translations/${ENTITY_TYPE}/${productId}`, { token: saToken })
      expect(getResponse.ok()).toBeTruthy()
      const body = (await getResponse.json()) as { translations: Record<string, Record<string, string>> }
      expect(body.translations.de.title).toBe('Deutscher Titel QA')
    } finally {
      await deleteTranslationIfExists(request, saToken, ENTITY_TYPE, productId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await setLocales(request, adminToken, originalLocales).catch(() => {})
    }
  })

  test('should persist translations after page reload', async ({ page, request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const saToken = await getAuthToken(request, 'superadmin')
    const originalLocales = await getLocales(request, adminToken)
    const productTitle = `QA TC-TRANS-005-3 ${Date.now()}`
    const sku = `QA-TRANS-005-3-${Date.now()}`
    let productId: string | null = null

    try {
      await setLocales(request, adminToken, [...new Set([...originalLocales, 'de'])])
      productId = await createProductFixture(request, adminToken, { title: productTitle, sku })

      await apiRequest(request, 'PUT', `/api/translations/${ENTITY_TYPE}/${productId}`, {
        token: saToken,
        data: { de: { title: 'Persistenter Titel' } },
      })

      await login(page, 'superadmin')
      await page.goto('/backend/config/translations')

      const entityInput = page.getByPlaceholder('Select an entity')
      await entityInput.fill('catalog_product')
      await page.locator('.absolute.z-50 button').filter({ hasText: /catalog_product/i }).first().click()

      const recordInput = page.getByPlaceholder('Search records...')
      await recordInput.fill(productTitle)
      await page.locator('.absolute.z-50 button').filter({ hasText: productTitle }).first().click()

      const managerCard = page.locator('.bg-card').filter({
        has: page.getByRole('button', { name: 'Save translations' }),
      })
      const deTab = managerCard.getByRole('button', { name: 'DE' })
      await deTab.click()

      await expect(page.locator('table input').first()).toHaveValue('Persistenter Titel')
    } finally {
      await deleteTranslationIfExists(request, saToken, ENTITY_TYPE, productId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await setLocales(request, adminToken, originalLocales).catch(() => {})
    }
  })
})
