import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'

/** TC-CAT-021: Duplicate SKU Validation */
test.describe('TC-CAT-021: Duplicate SKU Validation', () => {
  test('should reject creating a second product with the same SKU', async ({ request }) => {
    const sku = `QA-CAT-021-DUP-${Date.now()}`
    let token: string | null = null
    let productIdA: string | null = null
    let productIdB: string | null = null

    try {
      token = await getAuthToken(request)

      productIdA = await createProductFixture(request, token, {
        title: `QA TC-CAT-021 Product A ${Date.now()}`,
        sku,
      })

      const duplicateResponse = await apiRequest(request, 'POST', '/api/catalog/products', {
        token,
        data: {
          title: `QA TC-CAT-021 Product B ${Date.now()}`,
          sku,
          description:
            'Long enough description for SEO checks in QA automation flows. This text keeps the create validation satisfied.',
        },
      })

      expect(
        [400, 409, 422].includes(duplicateResponse.status()),
        `Expected 400, 409, or 422 for duplicate SKU but got ${duplicateResponse.status()}`,
      ).toBeTruthy()

      const errorBody = await duplicateResponse.json().catch(() => null)

      if (duplicateResponse.ok()) {
        productIdB = (errorBody as { id?: string })?.id ?? null
      }
    } finally {
      await deleteCatalogProductIfExists(request, token, productIdA)
      await deleteCatalogProductIfExists(request, token, productIdB)
    }
  })

  test('should reject creating a variant with a duplicate SKU on the same product', async ({ request }) => {
    const sku = `QA-CAT-021-VAR-${Date.now()}`
    let token: string | null = null
    let productId: string | null = null

    try {
      token = await getAuthToken(request)

      productId = await createProductFixture(request, token, {
        title: `QA TC-CAT-021 Variant Host ${Date.now()}`,
        sku: `QA-CAT-021-BASE-${Date.now()}`,
      })

      const firstVariantResponse = await apiRequest(request, 'POST', '/api/catalog/variants', {
        token,
        data: {
          productId,
          name: `Variant A ${Date.now()}`,
          sku,
          isDefault: false,
          isActive: true,
        },
      })
      expect(
        firstVariantResponse.ok(),
        `Failed to create first variant: ${firstVariantResponse.status()}`,
      ).toBeTruthy()

      const duplicateVariantResponse = await apiRequest(request, 'POST', '/api/catalog/variants', {
        token,
        data: {
          productId,
          name: `Variant B ${Date.now()}`,
          sku,
          isDefault: false,
          isActive: true,
        },
      })

      expect(
        [400, 409, 422].includes(duplicateVariantResponse.status()),
        `Expected 400, 409, or 422 for duplicate variant SKU but got ${duplicateVariantResponse.status()}`,
      ).toBeTruthy()
    } finally {
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})
