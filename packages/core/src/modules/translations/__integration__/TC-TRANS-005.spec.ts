import { expect, test, type Locator, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { deleteTranslationIfExists, getLocales, setLocales } from './helpers/translationFixtures'

const ENTITY_TYPE = 'catalog:catalog_product'

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Helper: set a value directly into a ComboboxInput using allowCustomValues.
 * Types the value and presses Enter to confirm — avoids flaky dropdown clicks
 * and search index lag for async suggestions.
 */
async function fillCombobox(
  page: import('@playwright/test').Page,
  placeholder: string,
  value: string,
  options?: { waitForEnabledPlaceholder?: string },
) {
  const input = page.getByPlaceholder(placeholder)
  await expect(input).toBeEnabled({ timeout: 10_000 })
  await input.click()
  await input.fill(value)
  const suggestion = page.getByRole('button', {
    name: new RegExp(escapeForRegex(value), 'i'),
  }).first()
  const suggestionVisible = await suggestion.waitFor({ state: 'visible', timeout: 2_000 }).then(
    () => true,
    () => false,
  )
  if (suggestionVisible) {
    await suggestion.click()
  } else {
    await input.press('Enter')
  }
  await input.press('Tab')
  if (options?.waitForEnabledPlaceholder) {
    await expect(page.getByPlaceholder(options.waitForEnabledPlaceholder)).toBeEnabled({ timeout: 10_000 })
  }
}

async function selectEntityForRecordPicker(
  page: Page,
  entityType: string,
) {
  const recordInput = page.getByPlaceholder('Search records...')

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await fillCombobox(page, 'Select an entity', entityType)
    const enabled = await expect
      .poll(async () => !(await recordInput.isDisabled()), { timeout: 4_000 })
      .toBe(true)
      .then(() => true)
      .catch(() => false)
    if (enabled) {
      return
    }
  }

  await expect(recordInput).toBeEnabled({ timeout: 10_000 })
}

async function waitForTranslationField(root: Locator, preferredPlaceholder?: string): Promise<Locator> {
  const fieldLocator = root.locator('table').locator('input, textarea')
  await expect.poll(async () => fieldLocator.count(), {
    message: 'Expected at least one translation input to be available',
    timeout: 45_000,
  }).toBeGreaterThan(0)

  const firstEditableField = fieldLocator.first()
  await expect(firstEditableField).toBeVisible()
  await expect(firstEditableField).toBeEnabled()

  const normalizedPlaceholder = preferredPlaceholder?.trim()
  if (!normalizedPlaceholder) return firstEditableField

  const preferredField = root.getByPlaceholder(normalizedPlaceholder).first()
  if (await preferredField.count()) {
    if (await preferredField.isVisible()) return preferredField
  }

  return firstEditableField
}

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

      await selectEntityForRecordPicker(page, ENTITY_TYPE)
      await fillCombobox(page, 'Search records...', productId!)

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

      await selectEntityForRecordPicker(page, ENTITY_TYPE)
      await fillCombobox(page, 'Search records...', productId!)

      const managerCard = page.locator('.bg-card').filter({
        has: page.getByRole('button', { name: 'Save translations' }),
      })
      const deTab = managerCard.getByRole('button', { name: 'DE' })
      await deTab.click()
      await expect(deTab).toHaveAttribute('data-state', 'active')

      const titleInput = await waitForTranslationField(managerCard, 'Deutscher Titel QA')
      await titleInput.click()
      await page.keyboard.type('Deutscher Titel QA')
      await expect.poll(async () => titleInput.inputValue()).toBe('Deutscher Titel QA')
      await titleInput.press('Tab')

      const saveResponsePromise = page.waitForResponse((response) =>
        response.request().method() === 'PUT'
        && response.url().includes(`/api/translations/${encodeURIComponent(ENTITY_TYPE)}/${productId}`),
      )
      await page.getByRole('button', { name: 'Save translations' }).click()
      const saveResponse = await saveResponsePromise
      expect(saveResponse.ok()).toBeTruthy()
      await expect(page.getByText('Translations saved').first()).toBeVisible()
      await expect.poll(async () => {
        const response = await apiRequest(request, 'GET', `/api/translations/${ENTITY_TYPE}/${productId}`, { token: saToken })
        if (!response.ok()) return null
        const body = (await response.json()) as { translations: Record<string, Record<string, string>> }
        return body.translations?.de?.title ?? null
      }).toBe('Deutscher Titel QA')

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

      await selectEntityForRecordPicker(page, ENTITY_TYPE)
      await fillCombobox(page, 'Search records...', productId!)

      const managerCard = page.locator('.bg-card').filter({
        has: page.getByRole('button', { name: 'Save translations' }),
      })
      const deTab = managerCard.getByRole('button', { name: 'DE' })
      await deTab.click()
      await expect(deTab).toHaveAttribute('data-state', 'active')

      const titleInput = await waitForTranslationField(managerCard, 'Persistenter Titel')
      await expect(titleInput).toHaveValue('Persistenter Titel')
    } finally {
      await deleteTranslationIfExists(request, saToken, ENTITY_TYPE, productId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await setLocales(request, adminToken, originalLocales).catch(() => {})
    }
  })
})
