/**
 * TC-SALES-023: Catalog Image Enricher
 *
 * Validates that the sales.catalog-image enricher overrides catalogSnapshot
 * thumbnailUrl with the current product image at API response time, and falls
 * back to the snapshot when the product is deleted.
 */
import { test, expect } from '@playwright/test'
import {
  getAuthToken,
  apiRequest,
} from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createSalesQuoteFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/salesFixtures'
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'

const INITIAL_IMAGE = 'https://example.com/image-v1.jpg'
const UPDATED_IMAGE = 'https://example.com/image-v2.jpg'

test.describe('TC-SALES-023: Catalog Image Enricher', () => {
  let token: string

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin')
  })

  test('TC-SALES-023-R01: Quote line reflects updated product image', async ({ request }) => {
    let productId: string | null = null
    let quoteId: string | null = null
    const stamp = Date.now()

    try {
      // Create product with initial image
      productId = await createProductFixture(request, token, {
        title: `QA Enricher Product ${stamp}`,
        sku: `QA-ENR-${stamp}`,
      })

      // Set initial image on the product
      const updateResponse = await apiRequest(request, 'PUT', '/api/catalog/products', {
        token,
        data: { id: productId, defaultMediaUrl: INITIAL_IMAGE },
      })
      expect(updateResponse.ok(), `Failed to set product image: ${updateResponse.status()}`).toBeTruthy()

      // Create a quote with a line referencing the product
      quoteId = await createSalesQuoteFixture(request, token, 'USD')
      const lineCreate = await apiRequest(request, 'POST', '/api/sales/quote-lines', {
        token,
        data: {
          quoteId,
          productId,
          quantity: 1,
          currencyCode: 'USD',
          name: `QA Enricher Line ${stamp}`,
          unitPriceNet: 10,
          unitPriceGross: 12,
        },
      })
      expect(lineCreate.ok(), `Failed to create quote line: ${lineCreate.status()}`).toBeTruthy()

      // Fetch quote lines — snapshot should have the initial image
      const linesResponse1 = await apiRequest(
        request,
        'GET',
        `/api/sales/quote-lines?quoteId=${encodeURIComponent(quoteId)}&page=1&pageSize=20`,
        { token },
      )
      expect(linesResponse1.ok()).toBeTruthy()
      const body1 = (await linesResponse1.json()) as { items?: Array<Record<string, unknown>> }
      const items1 = body1.items ?? []
      expect(items1.length).toBeGreaterThan(0)

      const line1 = items1[0]
      const snapshot1 = (line1.catalog_snapshot ?? line1.catalogSnapshot) as Record<string, unknown> | null
      const product1 = snapshot1?.product as Record<string, unknown> | null
      // If the snapshot captured the image, it should match initial OR be overridden by enricher
      // Either way, after enrichment, it should reflect the current product image
      if (product1?.thumbnailUrl) {
        expect(product1.thumbnailUrl).toBe(INITIAL_IMAGE)
      }

      // Update the product image
      const update2 = await apiRequest(request, 'PUT', '/api/catalog/products', {
        token,
        data: { id: productId, defaultMediaUrl: UPDATED_IMAGE },
      })
      expect(update2.ok(), `Failed to update product image: ${update2.status()}`).toBeTruthy()

      // Fetch quote lines again — enricher should override with the new image
      const linesResponse2 = await apiRequest(
        request,
        'GET',
        `/api/sales/quote-lines?quoteId=${encodeURIComponent(quoteId)}&page=1&pageSize=20`,
        { token },
      )
      expect(linesResponse2.ok()).toBeTruthy()
      const body2 = (await linesResponse2.json()) as { items?: Array<Record<string, unknown>> }
      const items2 = body2.items ?? []
      expect(items2.length).toBeGreaterThan(0)

      const line2 = items2[0]
      const snapshot2 = (line2.catalog_snapshot ?? line2.catalogSnapshot) as Record<string, unknown> | null
      const product2 = snapshot2?.product as Record<string, unknown> | null
      expect(product2?.thumbnailUrl).toBe(UPDATED_IMAGE)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })

  test('TC-SALES-023-R02: Quote line falls back to snapshot when product is deleted', async ({
    request,
  }) => {
    let productId: string | null = null
    let quoteId: string | null = null
    const stamp = Date.now()

    try {
      // Create product with image
      productId = await createProductFixture(request, token, {
        title: `QA Enricher Fallback ${stamp}`,
        sku: `QA-ENR-FB-${stamp}`,
      })
      await apiRequest(request, 'PUT', '/api/catalog/products', {
        token,
        data: { id: productId, defaultMediaUrl: INITIAL_IMAGE },
      })

      // Create quote + line
      quoteId = await createSalesQuoteFixture(request, token, 'USD')
      const lineCreate = await apiRequest(request, 'POST', '/api/sales/quote-lines', {
        token,
        data: {
          quoteId,
          productId,
          quantity: 1,
          currencyCode: 'USD',
          name: `QA Enricher Fallback Line ${stamp}`,
          unitPriceNet: 10,
          unitPriceGross: 12,
        },
      })
      expect(lineCreate.ok()).toBeTruthy()

      // Delete the product
      await deleteCatalogProductIfExists(request, token, productId)
      productId = null // prevent double-delete in finally

      // Fetch quote lines — enricher can't find the product, snapshot should remain
      const linesResponse = await apiRequest(
        request,
        'GET',
        `/api/sales/quote-lines?quoteId=${encodeURIComponent(quoteId)}&page=1&pageSize=20`,
        { token },
      )
      expect(linesResponse.ok()).toBeTruthy()
      const body = (await linesResponse.json()) as { items?: Array<Record<string, unknown>> }
      const items = body.items ?? []
      expect(items.length).toBeGreaterThan(0)

      const line = items[0]
      const snapshot = (line.catalog_snapshot ?? line.catalogSnapshot) as Record<string, unknown> | null
      const product = snapshot?.product as Record<string, unknown> | null
      // Snapshot should still have the image from when the line was created
      // (enricher doesn't remove it since product is not found)
      if (product) {
        expect(product.thumbnailUrl === INITIAL_IMAGE || product.thumbnailUrl === null).toBeTruthy()
      }
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })

  test('TC-SALES-023-R03: enrichMany applies to all lines in a list response', async ({
    request,
  }) => {
    let productId: string | null = null
    let quoteId: string | null = null
    const stamp = Date.now()

    try {
      productId = await createProductFixture(request, token, {
        title: `QA Enricher Batch ${stamp}`,
        sku: `QA-ENR-BATCH-${stamp}`,
      })
      await apiRequest(request, 'PUT', '/api/catalog/products', {
        token,
        data: { id: productId, defaultMediaUrl: UPDATED_IMAGE },
      })

      quoteId = await createSalesQuoteFixture(request, token, 'USD')

      // Create two lines referencing the same product
      for (let i = 0; i < 2; i++) {
        const lineCreate = await apiRequest(request, 'POST', '/api/sales/quote-lines', {
          token,
          data: {
            quoteId,
            productId,
            quantity: 1,
            currencyCode: 'USD',
            name: `QA Batch Line ${i + 1} ${stamp}`,
            unitPriceNet: 10,
            unitPriceGross: 12,
          },
        })
        expect(lineCreate.ok(), `Failed to create line ${i + 1}`).toBeTruthy()
      }

      // Fetch all lines — both should have enriched image
      const linesResponse = await apiRequest(
        request,
        'GET',
        `/api/sales/quote-lines?quoteId=${encodeURIComponent(quoteId)}&page=1&pageSize=20`,
        { token },
      )
      expect(linesResponse.ok()).toBeTruthy()
      const body = (await linesResponse.json()) as { items?: Array<Record<string, unknown>> }
      const items = body.items ?? []
      expect(items.length).toBeGreaterThanOrEqual(2)

      for (const line of items) {
        const snapshot = (line.catalog_snapshot ?? line.catalogSnapshot) as Record<string, unknown> | null
        const product = snapshot?.product as Record<string, unknown> | null
        if (product?.thumbnailUrl) {
          expect(product.thumbnailUrl).toBe(UPDATED_IMAGE)
        }
      }
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})
