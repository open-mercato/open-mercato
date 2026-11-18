import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { encodeProductUseIntent, PRODUCT_USE_INTENT_HEADER } from '../lib/productUseIntent'
import { setProductUse, stampOf } from './helpers'

type ProductItem = {
  id: string
  title?: string
  updatedAt?: string | null
  updated_at?: string | null
  _property_management?: { use: string | null; billingUnit: string | null }
}

type SavedBody = { _property_management?: { productUseError?: { status: number; error: string } } }

async function readProduct(request: APIRequestContext, token: string, productId: string): Promise<ProductItem | null> {
  const response = await apiRequest(request, 'GET', `/api/catalog/products?id=${productId}`, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{ items?: ProductItem[] }>(response)
  return body?.items?.find((entry) => entry.id === productId) ?? null
}

async function readProductUses(request: APIRequestContext, token: string, productId: string): Promise<Array<[string, string | null]>> {
  const body = await readJsonSafe<{ items?: Array<{ use: string; billingUnit: string | null }> }>(
    await apiRequest(request, 'GET', `/api/property_management/product-uses?productIds=${productId}`, { token }),
  )
  return (body?.items ?? []).map((entry) => [entry.use, entry.billingUnit])
}

/**
 * TC-PM-007: product uses and the catalog enricher
 * A product flagged bookable through `product-uses` is enriched with its use and billing unit on
 * `GET /api/catalog/products`; a leasable product is billed per month only; clearing the use removes it.
 * Saving the catalog product form with the product's own optimistic-lock header and a use intent
 * changes an existing use: the catalog lock token is never checked against the product-use row.
 */
test.describe('TC-PM-007: product use enrichment', () => {
  test('enriches a flagged product on the catalog list', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let productId: string | null = null
    try {
      productId = await createProductFixture(request, token, { title: `QA PM room ${stamp}`, sku: `QA-PM-ROOM-${stamp}` })

      const invalid = await setProductUse(request, token, productId, 'leasable', 'hour')
      expect([400, 422], 'a leasable product is billed per month').toContain(invalid.status())

      const flagged = await setProductUse(request, token, productId, 'bookable', 'hour')
      expect(flagged.status()).toBe(201)

      const list = await apiRequest(request, 'GET', `/api/catalog/products?id=${productId}`, { token })
      expect(list.status()).toBe(200)
      const body = await readJsonSafe<{ items?: ProductItem[] }>(list)
      const item = body?.items?.find((entry) => entry.id === productId)
      expect(item?._property_management).toEqual({ use: 'bookable', billingUnit: 'hour' })

      const uses = await readJsonSafe<{ items?: Array<{ catalogProductId: string; use: string }> }>(
        await apiRequest(request, 'GET', `/api/property_management/product-uses?productIds=${productId}`, { token }),
      )
      expect(uses?.items?.map((entry) => entry.use)).toEqual(['bookable'])

      const cleared = await apiRequest(request, 'DELETE', `/api/property_management/product-uses?catalogProductId=${productId}`, { token })
      expect(cleared.status()).toBe(200)
      const afterClear = await readJsonSafe<{ items?: ProductItem[] }>(
        await apiRequest(request, 'GET', `/api/catalog/products?id=${productId}`, { token }),
      )
      expect(afterClear?.items?.find((entry) => entry.id === productId)?._property_management).toEqual({ use: null, billingUnit: null })
    } finally {
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })

  test('changes an existing use from the catalog product form under the product lock', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let productId: string | null = null
    try {
      productId = await createProductFixture(request, token, { title: `QA PM desk ${stamp}`, sku: `QA-PM-DESK-${stamp}` })
      expect((await setProductUse(request, token, productId, 'bookable', 'hour')).status()).toBe(201)
      expect(await readProductUses(request, token, productId)).toEqual([['bookable', 'hour']])

      const before = await readProduct(request, token, productId)
      const rawUpdatedAt = before?.updatedAt ?? before?.updated_at
      expect(typeof rawUpdatedAt, 'the catalog product exposes its updatedAt').toBe('string')
      const productUpdatedAt = new Date(Date.parse(rawUpdatedAt as string)).toISOString()

      const renamed = `QA PM desk renamed ${stamp}`
      const saved = await apiRequest(request, 'PUT', '/api/catalog/products', {
        token,
        data: { id: productId, title: renamed },
        headers: {
          [OPTIMISTIC_LOCK_HEADER_NAME]: productUpdatedAt,
          [PRODUCT_USE_INTENT_HEADER]: encodeProductUseIntent({ sourceEntityId: 'catalog:catalog_product', use: 'bookable', billingUnit: 'day' }),
        },
      })
      const savedBody = await readJsonSafe<SavedBody>(saved)
      expect(saved.status(), `PUT /api/catalog/products → ${JSON.stringify(savedBody)}`).toBe(200)
      expect(savedBody?._property_management?.productUseError, 'the product use syncs without an error').toBeUndefined()

      expect(await readProductUses(request, token, productId), 'the existing use is changed').toEqual([['bookable', 'day']])
      const after = await readProduct(request, token, productId)
      expect(after?.title).toBe(renamed)
      expect(after?._property_management).toEqual({ use: 'bookable', billingUnit: 'day' })
    } finally {
      if (productId) await setProductUse(request, token, productId, null, null).catch(() => undefined)
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})
