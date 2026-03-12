import { expect, test, type Locator, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { deleteTranslationIfExists, getLocales, setLocales } from './helpers/translationFixtures'

const ENTITY_TYPE = 'catalog:catalog_product'

async function dismissRecordDeletedDialogIfPresent(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: /Record was deleted/i })
  const visible = await dialog.isVisible().catch(() => false)
  if (!visible) return
  const closeButton = dialog.getByRole('button', { name: /Close/i }).first()
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click()
  } else {
    await page.keyboard.press('Escape')
  }
  await expect(dialog).toHaveCount(0)
}

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
  const fieldLocator = dialog.locator('table').locator('input, textarea')
  await expect.poll(async () => fieldLocator.count(), {
    message: 'Expected at least one translation input to be available',
    timeout: 45_000,
  }).toBeGreaterThan(0)
  const firstEditableField = fieldLocator.first()
  await expect(firstEditableField).toBeVisible()
  await expect(firstEditableField).toBeEnabled()

  const normalizedPlaceholder = preferredPlaceholder?.trim()
  if (!normalizedPlaceholder) return firstEditableField

  const preferredField = dialog.getByPlaceholder(normalizedPlaceholder).first()
  if (await preferredField.count()) {
    if (await preferredField.isVisible()) return preferredField
  }

  return firstEditableField
}

async function openLocaleFieldWithRetry(
  page: Page,
  localeCode: string,
  preferredPlaceholder?: string,
): Promise<{ dialog: Locator; field: Locator }> {
  let dialog = await openTranslationsDrawer(page)
  await expect(dialog).toBeVisible()
  await dismissRecordDeletedDialogIfPresent(page)
  const localeButton = dialog.getByRole('button', { name: localeCode })
  await expect(localeButton).toBeVisible()
  await expect(localeButton).toBeEnabled()
  await localeButton.click()

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const field = await waitForTranslationField(dialog, preferredPlaceholder)
      return { dialog, field }
    } catch (error) {
      if (attempt === 1) throw error
      await page.keyboard.press('Escape').catch(() => {})
      await dismissRecordDeletedDialogIfPresent(page)
      dialog = await openTranslationsDrawer(page)
      await expect(dialog).toBeVisible()
      await dismissRecordDeletedDialogIfPresent(page)
      const retryLocaleButton = dialog.getByRole('button', { name: localeCode })
      await expect(retryLocaleButton).toBeVisible()
      await expect(retryLocaleButton).toBeEnabled()
      await retryLocaleButton.click()
    }
  }

  throw new Error('Could not resolve translation field after retry')
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
      await page.waitForLoadState('domcontentloaded')
      await dismissRecordDeletedDialogIfPresent(page)

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
      await page.waitForLoadState('domcontentloaded')
      await dismissRecordDeletedDialogIfPresent(page)

      const { field: translationField } = await openLocaleFieldWithRetry(page, 'DE', productTitle)
      await translationField.fill('Widget Titel QA')
      await translationField.press('Tab')

      const saveTranslationsButton = page.getByRole('dialog', { name: /Translations/i }).getByTestId('translations-save')
      await expect(saveTranslationsButton).toBeVisible()
      await expect(saveTranslationsButton).toBeEnabled()
      await saveTranslationsButton.click()
      await expect(page.getByText('Translations saved').first()).toBeVisible()
    } finally {
      await deleteTranslationIfExists(request, saToken, ENTITY_TYPE, productId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await setLocales(request, adminToken, originalLocales).catch(() => {})
    }
  })

  test('should verify drawer-saved translation via API', async ({ page, request }) => {
    test.setTimeout(120_000)
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
      await page.waitForLoadState('domcontentloaded')
      await dismissRecordDeletedDialogIfPresent(page)

      const { field: translationField } = await openLocaleFieldWithRetry(page, 'DE', productTitle)
      await translationField.fill('API Verifiziert QA')
      await translationField.press('Tab')

      const saveTranslationsButton = page.getByRole('dialog', { name: /Translations/i }).getByTestId('translations-save')
      await expect(saveTranslationsButton).toBeVisible()
      await expect(saveTranslationsButton).toBeEnabled()
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
