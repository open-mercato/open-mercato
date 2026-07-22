import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'

/**
 * TC-CAT-028: Product-unit-conversions reject a duplicate unit on the same product.
 * Source: issue #2484 (catalog integration coverage), scenario TC-CAT-028.
 *
 * `(product_id, unit_code)` is unique (`catalog_product_unit_conversions_unique`).
 * The create command catches the violation and re-throws it as
 * `HTTP 409 { error: 'uom.duplicate_conversion' }`. TC-CAT-014 covers unit
 * canonicalization but never the uniqueness constraint.
 */
test.describe('TC-CAT-028: Product unit conversion duplicate rejection', () => {
  test('rejects a second conversion with the same unit code on a product', async ({ request }) => {
    const suffix = Date.now()
    let token: string | null = null
    let productId: string | null = null
    let conversionId: string | null = null

    try {
      token = await getAuthToken(request)

      productId = await createProductFixture(request, token, {
        title: `QA Unit Dup ${suffix}`,
        sku: `QA-CAT-028-${suffix}`,
      })

      const firstRes = await apiRequest(request, 'POST', '/api/catalog/product-unit-conversions', {
        token,
        data: { productId, unitCode: 'box', toBaseFactor: 12 },
      })
      expect(firstRes.status(), `First conversion should be created: ${firstRes.status()}`).toBe(201)
      conversionId = ((await firstRes.json()) as { id?: string }).id ?? null
      expect(conversionId, 'Conversion id is required').toBeTruthy()

      const duplicateRes = await apiRequest(
        request,
        'POST',
        '/api/catalog/product-unit-conversions',
        {
          token,
          data: { productId, unitCode: 'box', toBaseFactor: 24 },
        },
      )
      expect(duplicateRes.status(), 'Duplicate unit on the same product must conflict').toBe(409)
      const duplicateBody = (await duplicateRes.json()) as { error?: string }
      expect(duplicateBody.error).toBe('uom.duplicate_conversion')
    } finally {
      if (token && conversionId) {
        await apiRequest(
          request,
          'DELETE',
          `/api/catalog/product-unit-conversions?id=${encodeURIComponent(conversionId)}`,
          { token },
        ).catch(() => undefined)
      }
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})
