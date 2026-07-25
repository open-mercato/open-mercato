import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { fillControlledInput } from '@open-mercato/core/modules/core/__integration__/helpers/ui'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'

/**
 * TC-CAT-COMP-004: Compliance section persists from the product edit page
 * (spec: .ai/specs/2026-06-11-catalog-compliance-and-commercial-product-fields.md).
 *
 * UI persistence smoke for the new compliance CrudForm group on
 * /backend/catalog/products/[id] (ProductComplianceSection): fill country of
 * origin, tick a GTU code, set the minimum order quantity, save via the
 * "Save changes" footer button (TC-LOCK-OSS-019 pattern), reload, and assert
 * the values are prefilled again (snake_case API -> camelCase form mapping).
 *
 * The fixture product is created via API and removed in finally. Waits use
 * explicit element visibility (no networkidle — the backend keeps SSE open).
 */

const PRODUCTS_PATH = '/api/catalog/products'
const TITLE_PLACEHOLDER = /summer sneaker/i
const COUNTRY_INPUT = '#catalog-product-compliance-country'
const GTU_07_CHECKBOX = '#catalog-product-compliance-gtu-GTU_07'
const MIN_QTY_INPUT = '#catalog-product-compliance-min-qty'

async function readProductById(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<Record<string, unknown>> {
  const response = await apiRequest(
    request,
    'GET',
    `${PRODUCTS_PATH}?id=${encodeURIComponent(id)}&page=1&pageSize=1`,
    { token },
  )
  expect(response.status(), `product read-back failed: ${response.status()}`).toBe(200)
  const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(response)
  const item = (body?.items ?? []).find((entry) => entry.id === id) ?? null
  expect(item, `product ${id} should be present in the list read-back`).toBeTruthy()
  return item as Record<string, unknown>
}

test.describe('TC-CAT-COMP-004: compliance UI persistence', () => {
  test('country, GTU code, and min order qty survive save + reload', async ({ page, request }) => {
    test.slow()

    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let productId: string | null = null

    try {
      productId = await createProductFixture(request, token, {
        title: `QA COMP-004 UI ${stamp}`,
        sku: `QA-COMP-004-${stamp}`,
      })

      await login(page, 'admin')
      await page.goto(`/backend/catalog/products/${encodeURIComponent(productId)}`, {
        waitUntil: 'domcontentloaded',
      })

      // Form loaded signal: the title input is rendered with the product data.
      const titleInput = page.getByPlaceholder(TITLE_PLACEHOLDER).first()
      await expect(titleInput).toBeVisible({ timeout: 15_000 })
      await expect(titleInput).toHaveValue(`QA COMP-004 UI ${stamp}`)

      const countryInput = page.locator(COUNTRY_INPUT)
      await expect(countryInput).toBeVisible()
      await fillControlledInput(countryInput, 'PL')

      const gtuCheckbox = page.locator(GTU_07_CHECKBOX)
      await gtuCheckbox.scrollIntoViewIfNeeded()
      await gtuCheckbox.click()
      await expect(gtuCheckbox, 'GTU_07 toggles on').toHaveAttribute('aria-checked', 'true')

      const minQtyInput = page.locator(MIN_QTY_INPUT)
      await fillControlledInput(minQtyInput, '3')

      const putPromise = page.waitForResponse(
        (response) =>
          response.request().method() === 'PUT' && response.url().includes(PRODUCTS_PATH),
        { timeout: 15_000 },
      )
      await page.getByRole('button', { name: /^save changes$/i }).first().click()
      const saveResponse = await putPromise
      expect(saveResponse.status(), 'compliance save should succeed').toBeLessThan(400)
      await expect(page.getByText(/product updated/i).first()).toBeVisible({ timeout: 15_000 })

      // Server state: camelCase submit landed as normalized snake_case columns.
      const persisted = await readProductById(request, token, productId)
      expect(persisted.country_of_origin_code, 'country persisted').toBe('PL')
      expect(
        Array.isArray(persisted.gtu_codes) ? (persisted.gtu_codes as unknown[]).map(String) : [],
        'GTU_07 persisted',
      ).toContain('GTU_07')
      expect(Number(persisted.min_order_qty), 'min order qty persisted').toBe(3)

      // Fresh load: the edit form prefills the compliance values again.
      await page.goto(`/backend/catalog/products/${encodeURIComponent(productId)}`, {
        waitUntil: 'domcontentloaded',
      })
      await expect(page.getByPlaceholder(TITLE_PLACEHOLDER).first()).toBeVisible({ timeout: 15_000 })

      const reloadedCountry = page.locator(COUNTRY_INPUT)
      await reloadedCountry.scrollIntoViewIfNeeded()
      await expect(reloadedCountry, 'country prefilled after reload').toHaveValue('PL')
      await expect(
        page.locator(GTU_07_CHECKBOX),
        'GTU_07 stays checked after reload',
      ).toHaveAttribute('aria-checked', 'true')
      await expect(
        page.locator(MIN_QTY_INPUT),
        'min order qty prefilled after reload',
      ).toHaveValue('3')
    } finally {
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})
