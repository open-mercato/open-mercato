import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { deleteTranslationIfExists, getLocales, setLocales } from './helpers/translationFixtures'

const ENTITY_TYPE = 'catalog:catalog_product'

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

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
  await page.waitForTimeout(300)
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

/**
 * TC-TRANS-009: Translation Command Undo
 * Verifies undo for save (create & update) translation commands via UI.
 */
test.describe('TC-TRANS-009: Translation Command Undo', () => {
  test('undo save (create) should remove the translation', async ({ page, request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const saToken = await getAuthToken(request, 'superadmin')
    const originalLocales = await getLocales(request, adminToken)
    const productTitle = `QA TC-TRANS-009-1 ${Date.now()}`
    const sku = `QA-TRANS-009-1-${Date.now()}`
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
      await managerCard.getByRole('button', { name: 'DE' }).click()

      const titleInput = page.locator('table input').first()
      await titleInput.fill('Deutscher Titel QA')

      await page.getByRole('button', { name: 'Save translations' }).click()
      await expect(page.getByText('Translations saved').first()).toBeVisible()

      // Verify translation was created via API
      const getBeforeUndo = await apiRequest(request, 'GET', `/api/translations/${ENTITY_TYPE}/${productId}`, { token: saToken })
      expect(getBeforeUndo.ok()).toBeTruthy()

      // Click the Undo button in the operation banner
      const undoButton = page.getByRole('button', { name: /^Undo(?: last action)?$/ })
      await expect(undoButton).toBeVisible()
      await undoButton.click()

      // Verify translation is gone via API
      await expect.poll(async () => {
        const resp = await apiRequest(request, 'GET', `/api/translations/${ENTITY_TYPE}/${productId}`, { token: saToken })
        return resp.status()
      }, { timeout: 10_000 }).toBe(404)
    } finally {
      await deleteTranslationIfExists(request, saToken, ENTITY_TYPE, productId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await setLocales(request, adminToken, originalLocales).catch(() => {})
    }
  })

  test('undo save (update) should restore previous translations', async ({ page, request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const saToken = await getAuthToken(request, 'superadmin')
    const originalLocales = await getLocales(request, adminToken)
    const productTitle = `QA TC-TRANS-009-2 ${Date.now()}`
    const sku = `QA-TRANS-009-2-${Date.now()}`
    let productId: string | null = null

    try {
      await setLocales(request, adminToken, [...new Set([...originalLocales, 'de'])])
      productId = await createProductFixture(request, adminToken, { title: productTitle, sku })

      // Create initial translation via API
      await apiRequest(request, 'PUT', `/api/translations/${ENTITY_TYPE}/${productId}`, {
        token: saToken,
        data: { de: { title: 'Original Titel' } },
      })

      await login(page, 'superadmin')
      await page.goto('/backend/config/translations')

      await selectEntityForRecordPicker(page, ENTITY_TYPE)
      await fillCombobox(page, 'Search records...', productId!)

      const managerCard = page.locator('.bg-card').filter({
        has: page.getByRole('button', { name: 'Save translations' }),
      })
      await managerCard.getByRole('button', { name: 'DE' }).click()

      // Verify the original translation is loaded
      const titleInput = page.locator('table input').first()
      await expect(titleInput).toHaveValue('Original Titel')

      // Update the translation via UI
      await titleInput.fill('Aktualisierter Titel')
      await page.getByRole('button', { name: 'Save translations' }).click()
      await expect(page.getByText('Translations saved').first()).toBeVisible()

      // Click the Undo button
      const undoButton = page.getByRole('button', { name: /^Undo(?: last action)?$/ })
      await expect(undoButton).toBeVisible()
      await undoButton.click()

      // Verify original translation restored via API
      await expect.poll(async () => {
        const resp = await apiRequest(request, 'GET', `/api/translations/${ENTITY_TYPE}/${productId}`, { token: saToken })
        if (!resp.ok()) return null
        const body = (await resp.json()) as { translations: Record<string, Record<string, string>> }
        return body.translations?.de?.title ?? null
      }, { timeout: 10_000 }).toBe('Original Titel')
    } finally {
      await deleteTranslationIfExists(request, saToken, ENTITY_TYPE, productId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await setLocales(request, adminToken, originalLocales).catch(() => {})
    }
  })
})
