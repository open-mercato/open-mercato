import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures'

type TaxRateFixture = {
  id: string
  name: string
}

async function createEntity(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', path, { token, data })
  expect(response.ok(), `Failed POST ${path}: ${response.status()}`).toBeTruthy()
  const payload = await readJsonSafe(response)
  const id = typeof (payload as Record<string, unknown>).id === 'string'
    ? ((payload as Record<string, unknown>).id as string)
    : null
  expect(id, `No id in POST ${path} response`).toBeTruthy()
  return id as string
}

async function createTaxRates(
  request: APIRequestContext,
  token: string,
  stamp: number,
  count: number,
): Promise<TaxRateFixture[]> {
  const fixtures: TaxRateFixture[] = []
  const batchSize = 12
  for (let index = 0; index < count; index += batchSize) {
    const batch = Array.from({ length: Math.min(batchSize, count - index) }, (_, offset) => index + offset)
    fixtures.push(
      ...(await Promise.all(
        batch.map(async (entry) => {
          const padded = String(entry).padStart(3, '0')
          const name = `QA Select Tax ${stamp} ${padded}`
          const id = await createEntity(request, token, '/api/sales/tax-rates', {
            name,
            code: `qa-select-tax-${stamp}-${padded}`,
            rate: 17,
            priority: entry % 10,
          })
          return { id, name }
        }),
      )),
    )
  }
  return fixtures
}

async function pickTaxRateOutsideFirstPage(
  request: APIRequestContext,
  token: string,
  fixtures: TaxRateFixture[],
): Promise<TaxRateFixture> {
  const response = await apiRequest(request, 'GET', '/api/sales/tax-rates?page=1&pageSize=200', { token })
  expect(response.ok(), `Failed to list tax rates: ${response.status()}`).toBeTruthy()
  const payload = await readJsonSafe(response)
  const firstPageIds = new Set(
    (Array.isArray((payload as Record<string, unknown>).items)
      ? ((payload as Record<string, unknown>).items as Array<Record<string, unknown>>)
      : [])
      .map((item) => (typeof item.id === 'string' ? item.id : null))
      .filter((id): id is string => Boolean(id)),
  )
  const selected = fixtures.find((fixture) => !firstPageIds.has(fixture.id))
  expect(selected, 'Expected a created tax rate to be outside the first tax-rate page').toBeTruthy()
  return selected as TaxRateFixture
}

async function deleteTaxRateIfExists(
  request: APIRequestContext,
  token: string,
  taxRateId: string | null,
): Promise<void> {
  if (!taxRateId) return
  try {
    await apiRequest(request, 'DELETE', `/api/sales/tax-rates?id=${encodeURIComponent(taxRateId)}`, { token })
  } catch {
    return
  }
}

test.describe('TC-CAT-034: Catalog edit forms prefill saved async selects', () => {
  test('product and variant edit show saved tax class outside the first async page', async ({ page, request }) => {
    test.slow()

    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const taxRates: TaxRateFixture[] = []
    let productId: string | null = null
    let variantProductId: string | null = null
    let variantId: string | null = null

    try {
      taxRates.push(...(await createTaxRates(request, token, stamp, 205)))
      const selectedTaxRate = await pickTaxRateOutsideFirstPage(request, token, taxRates)

      productId = await createEntity(request, token, '/api/catalog/products', {
        title: `QA Select Product ${stamp}`,
        sku: `QA-SELECT-PROD-${stamp}`,
        description: 'Product fixture for async select prefill integration coverage.',
        taxRateId: selectedTaxRate.id,
      })
      variantProductId = await createEntity(request, token, '/api/catalog/products', {
        title: `QA Select Variant Parent ${stamp}`,
        sku: `QA-SELECT-PARENT-${stamp}`,
        description: 'Variant parent fixture for async select prefill integration coverage.',
      })
      variantId = await createEntity(request, token, '/api/catalog/variants', {
        productId: variantProductId,
        name: `QA Select Variant ${stamp}`,
        sku: `QA-SELECT-VAR-${stamp}`,
        isActive: true,
        taxRateId: selectedTaxRate.id,
      })

      await login(page, 'admin')
      await page.goto(`/backend/catalog/products/${encodeURIComponent(productId)}`)
      await expect(page.locator(`input[value="QA Select Product ${stamp}"]`).first()).toBeVisible()
      const productTaxField = page
        .getByText('Tax class', { exact: true })
        .locator('xpath=ancestor::div[contains(@class,"space-y-2")]')
        .first()
      await expect(productTaxField.getByRole('combobox')).toContainText(selectedTaxRate.name)

      await page.goto(
        `/backend/catalog/products/${encodeURIComponent(variantProductId)}/variants/${encodeURIComponent(variantId)}`,
      )
      await expect(page.locator(`input[value="QA Select Variant ${stamp}"]`).first()).toBeVisible()
      const pricesSection = page
        .getByText('Prices', { exact: true })
        .locator('xpath=ancestor::div[contains(@class,"space-y-4")]')
        .first()
      await expect(pricesSection.getByRole('combobox').first()).toContainText(selectedTaxRate.name)
    } finally {
      await deleteCatalogProductIfExists(request, token, productId)
      await deleteCatalogProductIfExists(request, token, variantProductId)
      for (const taxRate of taxRates.reverse()) {
        await deleteTaxRateIfExists(request, token, taxRate.id)
      }
    }
  })
})
