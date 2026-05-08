import { expect, test } from '@playwright/test'
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
  page: import('@playwright/test').Page,
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

async function fillTranslationInput(locator: import('@playwright/test').Locator, value: string) {
  await expect(locator).toBeEditable({ timeout: 10_000 })
  await locator.fill(value)
  await locator.evaluate((element, nextValue) => {
    const input = element as HTMLInputElement | HTMLTextAreaElement
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    valueSetter?.call(input, nextValue)
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: nextValue }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
  await expect(locator).toHaveValue(value)
  await locator.press('Tab')
  await expect(locator).toHaveValue(value)
}

async function saveTranslations(
  page: import('@playwright/test').Page,
  managerCard: import('@playwright/test').Locator,
  entityType: string,
  entityId: string,
) {
  const encodedEntityType = encodeURIComponent(entityType)
  const encodedEntityId = encodeURIComponent(entityId)
  const isSaveRequest = (request: import('@playwright/test').Request) => {
    const url = request.url()
    return (
      request.method() === 'PUT' &&
      url.includes('/api/translations/') &&
      (url.includes(encodedEntityType) || url.includes(entityType)) &&
      (url.includes(encodedEntityId) || url.includes(entityId))
    )
  }
  const waitForSaveRequest = () =>
    page.waitForRequest(
      (request) => isSaveRequest(request),
      { timeout: 2_000 },
    )

  let requestPromise = waitForSaveRequest()
  await managerCard.getByRole('button', { name: 'Save translations' }).click()
  let request = await requestPromise.catch(() => null)

  if (!request) {
    requestPromise = waitForSaveRequest()
    await managerCard.getByRole('button', { name: 'Save translations' }).click()
    request = await requestPromise
  }

  expect(request.method()).toBe('PUT')
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

      const titleInput = page.locator('table input').first()
      await fillTranslationInput(titleInput, 'Deutscher Titel QA')

      await saveTranslations(page, managerCard, ENTITY_TYPE, productId!)
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

      await expect(page.locator('table input').first()).toHaveValue('Persistenter Titel')
    } finally {
      await deleteTranslationIfExists(request, saToken, ENTITY_TYPE, productId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await setLocales(request, adminToken, originalLocales).catch(() => {})
    }
  })
})
