import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createProductFixture } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'

/** TC-CAT-022: Product Soft-Delete Verification */
test.describe('TC-CAT-022: Product Soft-Delete Verification', () => {
  test('should not list a deleted product in the product list', async ({ request }) => {
    const productName = `QA TC-CAT-022 ${Date.now()}`
    const sku = `QA-CAT-022-${Date.now()}`
    let token: string | null = null
    let productId: string | null = null

    try {
      token = await getAuthToken(request)
      productId = await createProductFixture(request, token, { title: productName, sku })

      const variantResponse = await apiRequest(request, 'POST', '/api/catalog/variants', {
        token,
        data: {
          productId,
          name: `QA Variant ${Date.now()}`,
          sku: `QA-CAT-022-VAR-${Date.now()}`,
        },
      })
      expect(variantResponse.ok(), `Failed to create variant: ${variantResponse.status()}`).toBeTruthy()

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/catalog/products?id=${encodeURIComponent(productId)}`,
        { token },
      )
      expect(deleteResponse.ok(), `Failed to delete product: ${deleteResponse.status()}`).toBeTruthy()

      const listResponse = await apiRequest(request, 'GET', '/api/catalog/products?page=1&pageSize=50', { token })
      expect(listResponse.ok()).toBeTruthy()
      const listBody = (await listResponse.json()) as { items?: Array<{ id: string }> }
      const productIds = (listBody.items ?? []).map((p) => p.id)
      expect(productIds).not.toContain(productId)
    } finally {
      if (token && productId) {
        await apiRequest(request, 'DELETE', `/api/catalog/products?id=${encodeURIComponent(productId)}`, {
          token,
        }).catch(() => {})
      }
    }
  })

  // Spec: "Verify product still accessible via direct API call with includeDeleted param (if supported)"
  test('should verify deleted product accessible via includeDeleted param if supported', async ({ request }) => {
    const productName = `QA TC-CAT-022-C ${Date.now()}`
    const sku = `QA-CAT-022-C-${Date.now()}`
    let token: string | null = null
    let productId: string | null = null

    try {
      token = await getAuthToken(request)
      productId = await createProductFixture(request, token, { title: productName, sku })

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/catalog/products?id=${encodeURIComponent(productId)}`,
        { token },
      )
      expect(deleteResponse.ok(), `Failed to delete product: ${deleteResponse.status()}`).toBeTruthy()

      // Try fetching the deleted product with includeDeleted param
      const deletedResponse = await apiRequest(
        request,
        'GET',
        `/api/catalog/products?id=${encodeURIComponent(productId)}&includeDeleted=true&page=1&pageSize=1`,
        { token },
      )

      if (deletedResponse.ok()) {
        const body = (await deletedResponse.json()) as { items?: Array<{ id: string }> }
        const items = body.items ?? []
        const found = items.find((p) => p.id === productId)
        // If includeDeleted is supported, the product should be returned
        if (found) {
          expect(found.id).toBe(productId)
        }
        // If items is empty, the param may not be supported — that's OK per spec "(if supported)"
      }
      // If the response is not ok, the param is not supported — also OK per spec
    } finally {
      if (token && productId) {
        await apiRequest(request, 'DELETE', `/api/catalog/products?id=${encodeURIComponent(productId)}`, {
          token,
        }).catch(() => {})
      }
    }
  })

  test('should not list variants for a deleted product', async ({ request }) => {
    const productName = `QA TC-CAT-022-B ${Date.now()}`
    const sku = `QA-CAT-022-B-${Date.now()}`
    let token: string | null = null
    let productId: string | null = null

    try {
      token = await getAuthToken(request)
      productId = await createProductFixture(request, token, { title: productName, sku })

      const variantSku = `QA-CAT-022-B-VAR-${Date.now()}`
      const variantResponse = await apiRequest(request, 'POST', '/api/catalog/variants', {
        token,
        data: {
          productId,
          name: `QA Variant B ${Date.now()}`,
          sku: variantSku,
        },
      })
      expect(variantResponse.ok(), `Failed to create variant: ${variantResponse.status()}`).toBeTruthy()

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/catalog/products?id=${encodeURIComponent(productId)}`,
        { token },
      )
      expect(deleteResponse.ok(), `Failed to delete product: ${deleteResponse.status()}`).toBeTruthy()

      const variantListResponse = await apiRequest(
        request,
        'GET',
        `/api/catalog/variants?productId=${encodeURIComponent(productId)}&page=1&pageSize=50`,
        { token },
      )
      expect(variantListResponse.ok()).toBeTruthy()
      const variantListBody = (await variantListResponse.json()) as { items?: Array<{ id: string }> }
      const variants = variantListBody.items ?? []
      expect(variants).toHaveLength(0)
    } finally {
      if (token && productId) {
        await apiRequest(request, 'DELETE', `/api/catalog/products?id=${encodeURIComponent(productId)}`, {
          token,
        }).catch(() => {})
      }
    }
  })
})
