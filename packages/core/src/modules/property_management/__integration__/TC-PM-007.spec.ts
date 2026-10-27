import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures'
import { setProductUse, stampOf } from './helpers'

type ProductItem = { id: string; _property_management?: { use: string | null; billingUnit: string | null } }

/**
 * TC-PM-007: product uses and the catalog enricher
 * A product flagged bookable through `product-uses` is enriched with its use and billing unit on
 * `GET /api/catalog/products`; a leasable product is billed per month only; clearing the use removes it.
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
})
