import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['eudr', 'catalog'],
}

const PRODUCT_MAPPINGS_PATH = '/api/eudr/product-mappings'
const CATALOG_PRODUCTS_PATH = '/api/catalog/products'
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

type ProductMappingRow = {
  id: string
  productId?: string | null
  commodity?: string | null
}

type ListResponse<T> = {
  items?: T[]
}

async function listMappingsByProductId(
  request: APIRequestContext,
  token: string,
  productId: string,
): Promise<ProductMappingRow[]> {
  const response = await apiRequest(
    request,
    'GET',
    `${PRODUCT_MAPPINGS_PATH}?productId=${encodeURIComponent(productId)}`,
    { token },
  )
  expect(response.status(), `list product mappings by productId failed: ${response.status()}`).toBe(200)
  const body = await readJsonSafe<ListResponse<ProductMappingRow>>(response)
  return body?.items ?? []
}

async function deleteMappingIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  if (!token || !id) return
  await apiRequest(
    request,
    'DELETE',
    `${PRODUCT_MAPPINGS_PATH}?id=${encodeURIComponent(id)}`,
    { token },
  ).catch(() => undefined)
}

async function expectNoErrorState(page: Page): Promise<void> {
  await expect(
    page.getByRole('heading', {
      name: /Application error: a client-side exception has occurred|Something went wrong/i,
    }).first(),
  ).not.toBeVisible()
}

/**
 * TC-EUDR-010: Searchable product picker on product-mapping create.
 *
 * Creates a catalog product via API, drives the LookupSelect-based product
 * picker on /backend/eudr/product-mappings/create (asserting the picker issues
 * a server-side `?search=` request and shows the product NAME, never the raw
 * UUID), saves the mapping, and verifies both the list page (name rendered,
 * no raw UUID in the created row's cells) and the
 * `GET /api/eudr/product-mappings?productId=` filter.
 */
test.describe('TC-EUDR-010: Searchable product picker', () => {
  test('searches products by name fragment, saves the mapping, and never surfaces raw UUIDs', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
    const productTitle = `TC-EUDR-010 Product ${stamp}`
    const notesText = `TC-EUDR-010 notes ${stamp}`
    let productId: string | null = null
    let mappingId: string | null = null

    try {
      productId = await createProductFixture(request, token, {
        title: productTitle,
        sku: `TC-EUDR-010-${stamp}`,
      })

      await login(page, 'admin')

      const initialProductsFetch = page.waitForResponse(
        (response) => new URL(response.url()).pathname.endsWith(CATALOG_PRODUCTS_PATH),
        { timeout: 30_000 },
      )
      await page.goto('/backend/eudr/product-mappings/create', { waitUntil: 'domcontentloaded' })
      const productField = page.locator('[data-crud-field-id="productId"]').first()
      await expect(productField).toBeVisible()
      // The picker fires an initial (empty-query) products fetch after
      // hydration; waiting for it guarantees typing reaches the live input.
      await initialProductsFetch

      const searchRequestPromise = page.waitForRequest((candidate) => {
        const url = new URL(candidate.url())
        return url.pathname.endsWith(CATALOG_PRODUCTS_PATH)
          && (url.searchParams.get('search') ?? '').includes(stamp)
      }, { timeout: 15_000 })
      await productField.locator('input').first().fill(stamp)
      const searchRequest = await searchRequestPromise
      expect(
        new URL(searchRequest.url()).searchParams.get('search'),
        'typing in the product picker should trigger a server-side search request',
      ).toContain(stamp)

      const option = productField.getByRole('button').filter({ hasText: productTitle }).first()
      await expect(option, 'picker option should show the product name').toBeVisible({ timeout: 15_000 })
      const optionText = await option.innerText()
      expect(optionText).toContain(productTitle)
      expect(optionText, 'picker option should not render the raw product UUID').not.toContain(productId)
      await option.click()

      const commodityTrigger = page.locator('[data-crud-field-id="commodity"] [role="combobox"]').first()
      await expect(commodityTrigger).toBeEnabled({ timeout: 15_000 })
      await commodityTrigger.click()
      await page.getByRole('option', { name: 'Coffee', exact: true }).first().click()

      await page.locator('[data-crud-field-id="notes"] textarea').first().fill(notesText)

      await page.getByRole('button', { name: 'Create mapping' }).first().click()
      await page.waitForURL(
        (url) => url.pathname.endsWith('/backend/eudr/product-mappings'),
        { timeout: 30_000 },
      )
      await expectNoErrorState(page)

      const mappings = await listMappingsByProductId(request, token, productId)
      const createdMapping = mappings.find((item) => item.productId === productId)
      expect(
        createdMapping,
        'GET /api/eudr/product-mappings?productId=<id> should return the created mapping',
      ).toBeTruthy()
      expect(createdMapping?.commodity).toBe('coffee')
      mappingId = createdMapping?.id ?? null

      // The list search covers notes, so the unique stamp deterministically
      // narrows the table to the created row regardless of page/sort state.
      await page.getByPlaceholder('Search product mappings').first().fill(stamp)
      const row = page.locator('tbody tr').filter({ hasText: productTitle }).first()
      await expect(row, 'list should render the created mapping by product name').toBeVisible({ timeout: 15_000 })
      const rowText = await row.innerText()
      expect(rowText).toContain(productTitle)
      expect(rowText, 'created row cells should not render the product UUID').not.toContain(productId)
      expect(
        UUID_PATTERN.test(rowText),
        `created row cells should not render any raw UUID: ${rowText}`,
      ).toBe(false)
    } finally {
      if (!mappingId && productId) {
        const leftoverMappings = await listMappingsByProductId(request, token, productId).catch(() => [])
        mappingId = leftoverMappings.find((item) => item.productId === productId)?.id ?? null
      }
      await deleteMappingIfExists(request, token, mappingId)
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})
