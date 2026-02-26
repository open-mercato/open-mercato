import { expect, test, type Locator, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { deleteTranslationIfExists, getLocales, setLocales } from './helpers/translationFixtures'

const ENTITY_TYPE = 'catalog:catalog_product'

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
 * TC-TRANS-006: Translation Action on Product Detail
 * Covers the translation action injected in CrudForm header that opens a translation dialog.
 */
test.describe('TC-TRANS-006: Translation Action on Product Detail', () => {
  test.use({ actionTimeout: 30_000 })
  test('should show translation action on product edit page', async ({ page, request }) => {
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

      const dialog = await openTranslationsDrawer(page)
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Save translations' })).toBeVisible()
    } finally {
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await setLocales(request, adminToken, originalLocales).catch(() => {})
    }
  })

  test('should enter and save a translation in the translation drawer', async ({ page, request }) => {
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

      const dialog = await openTranslationsDrawer(page)
      await expect(dialog).toBeVisible()

      const deTab = dialog.getByRole('button', { name: 'DE' })
      await deTab.click()

      const translationField = await waitForTranslationField(dialog, productTitle)
      await translationField.fill('Widget Titel QA')

      const saveTranslationsButton = dialog.getByRole('button', { name: 'Save translations' })
      await expect(saveTranslationsButton).toBeVisible()
      await saveTranslationsButton.click()
      await expect(page.getByText('Translations saved').first()).toBeVisible()
    } finally {
      await deleteTranslationIfExists(request, saToken, ENTITY_TYPE, productId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await setLocales(request, adminToken, originalLocales).catch(() => {})
    }
  })

  test('should verify drawer-saved translation via API', async ({ page, request }) => {
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

      const dialog = await openTranslationsDrawer(page)
      await expect(dialog).toBeVisible()
      const deTab = dialog.getByRole('button', { name: 'DE' })
      await deTab.click()

      const translationField = await waitForTranslationField(dialog, productTitle)
      await translationField.fill('API Verifiziert QA')

      const saveTranslationsButton = dialog.getByRole('button', { name: 'Save translations' })
      await expect(saveTranslationsButton).toBeVisible()
      await saveTranslationsButton.click()
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
