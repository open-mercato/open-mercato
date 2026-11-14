import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  createProductFixture,
  createVariantFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'
import { deleteGeneralEntityIfExists, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { ensureEnglishLocale } from './helpers/wmsUi'

export const integrationMeta = {
  dependsOnModules: ['wms', 'catalog'],
}

type InventoryProfileSummary = {
  profileId?: string
  defaultUom?: string | null
  trackLot?: boolean
  reorderPoint?: string | number
  safetyStock?: string | number
}

type ProductListResponse = {
  items?: Array<{ _wms?: { inventoryProfile?: InventoryProfileSummary | null } }>
}

const CARD_TITLE = 'Inventory profile'

function wmsField(page: Page, fieldId: string) {
  return page.locator(`[data-crud-field-id="${fieldId}"]`).first()
}

function wmsInput(page: Page, fieldId: string) {
  return page.locator(`[data-crud-field-id="${fieldId}"] input, input[data-crud-field-id="${fieldId}"]`).first()
}

async function readProductProfile(
  request: APIRequestContext,
  token: string,
  productId: string,
): Promise<InventoryProfileSummary | null> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/catalog/products?id=${encodeURIComponent(productId)}&page=1&pageSize=1`,
    { token },
  )
  expect(response.ok(), `GET product should succeed: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<ProductListResponse>(response)
  return body?.items?.[0]?._wms?.inventoryProfile ?? null
}

/**
 * TC-WMS-CATALOG-PROFILE-001: the WMS inventory-profile fields injected into the
 * catalog product/variant forms render as their own card and persist (#6142).
 */
test.describe('TC-WMS-CATALOG-PROFILE-001: product form WMS inventory profile', () => {
  test('configures, saves and reloads the inventory profile from the product edit form', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const suffix = randomUUID().slice(0, 8)
    let productId: string | null = null
    let profileId: string | null = null

    try {
      productId = await createProductFixture(request, token, {
        title: `QA WMS profile ${suffix}`,
        sku: `QA-WMS-PROFILE-${suffix}`,
      })
      const variantId = await createVariantFixture(request, token, {
        productId,
        name: `QA WMS profile variant ${suffix}`,
        sku: `QA-WMS-PROFILE-V-${suffix}`,
      })

      await ensureEnglishLocale(page)
      await login(page, 'admin')
      await page.goto(`/backend/catalog/products/${productId}`)

      await expect(page.getByText(CARD_TITLE, { exact: true }).first()).toBeVisible({ timeout: 30_000 })
      const manageToggle = wmsField(page, 'wms.manageInventory').locator('[role="checkbox"]').first()
      await expect(manageToggle).toBeVisible()
      await expect(manageToggle).toHaveAttribute('aria-checked', 'false')
      await expect(wmsField(page, 'wms.reorderPoint')).toBeHidden()

      await manageToggle.click()
      for (const fieldId of [
        'wms.defaultUom',
        'wms.defaultStrategy',
        'wms.trackLot',
        'wms.trackSerial',
        'wms.trackExpiration',
        'wms.reorderPoint',
        'wms.safetyStock',
      ]) {
        await expect(wmsField(page, fieldId)).toBeVisible()
      }
      await wmsInput(page, 'wms.defaultUom').fill('pcs')
      await wmsField(page, 'wms.trackLot').locator('[role="checkbox"]').first().click()
      await wmsInput(page, 'wms.reorderPoint').fill('5')
      await wmsInput(page, 'wms.safetyStock').fill('2')

      const saveResponse = page.waitForResponse(
        (response) => response.url().includes('/api/catalog/products') && response.request().method() === 'PUT',
      )
      await page.getByRole('button', { name: 'Save changes' }).first().click()
      expect((await saveResponse).ok()).toBeTruthy()

      await expect
        .poll(async () => (await readProductProfile(request, token, productId as string))?.defaultUom ?? null, { timeout: 15_000 })
        .toBe('pcs')
      const profile = await readProductProfile(request, token, productId)
      profileId = profile?.profileId ?? null
      expect(profile?.trackLot).toBe(true)
      expect(Number(profile?.reorderPoint)).toBe(5)
      expect(Number(profile?.safetyStock)).toBe(2)

      await expect(manageToggle).toHaveAttribute('aria-checked', 'true')
      await expect(wmsInput(page, 'wms.reorderPoint')).toHaveValue('5')

      await page.goto(`/backend/catalog/products/${productId}`)
      await expect(page.getByText(CARD_TITLE, { exact: true }).first()).toBeVisible({ timeout: 30_000 })
      await expect(wmsField(page, 'wms.manageInventory').locator('[role="checkbox"]').first()).toHaveAttribute('aria-checked', 'true')
      await expect(wmsInput(page, 'wms.defaultUom')).toHaveValue('pcs')
      await expect(wmsInput(page, 'wms.reorderPoint')).toHaveValue('5')

      await wmsField(page, 'wms.manageInventory').locator('[role="checkbox"]').first().click()
      await expect(wmsField(page, 'wms.reorderPoint')).toBeHidden()
      const removeResponse = page.waitForResponse(
        (response) => response.url().includes('/api/catalog/products') && response.request().method() === 'PUT',
      )
      await page.getByRole('button', { name: 'Save changes' }).first().click()
      expect((await removeResponse).ok()).toBeTruthy()

      await expect
        .poll(async () => (await readProductProfile(request, token, productId as string))?.profileId ?? null, { timeout: 15_000 })
        .toBeNull()

      await page.goto(`/backend/catalog/products/${productId}`)
      await expect(page.getByText(CARD_TITLE, { exact: true }).first()).toBeVisible({ timeout: 30_000 })
      await expect(wmsField(page, 'wms.manageInventory').locator('[role="checkbox"]').first()).toHaveAttribute('aria-checked', 'false')
      await expect(wmsField(page, 'wms.reorderPoint')).toBeHidden()

      await page.goto(`/backend/catalog/products/${productId}/variants/${variantId}`)
      await expect(page.getByText(CARD_TITLE, { exact: true }).first()).toBeVisible({ timeout: 30_000 })
      await expect(wmsField(page, 'wms.manageInventory')).toBeVisible()

      await page.goto('/backend/catalog/products/create')
      await expect(page.getByText(CARD_TITLE, { exact: true }).first()).toBeVisible({ timeout: 30_000 })
    } finally {
      await deleteGeneralEntityIfExists(request, token, '/api/wms/inventory-profiles', profileId)
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})
