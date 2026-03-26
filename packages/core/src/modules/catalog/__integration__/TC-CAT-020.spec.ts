import { expect, test } from '@playwright/test'
import {
  createProductFixture,
  deleteCatalogProductIfExists,
  createCategoryFixture,
  deleteCatalogCategoryIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

/** TC-CAT-020: Advanced Product Filtering */
test.describe('TC-CAT-020: Advanced Product Filtering', () => {
  test('should filter products by category', async ({ request }) => {
    const suffix = Date.now()
    let token: string | null = null
    let categoryAId: string | null = null
    let categoryBId: string | null = null
    let productAId: string | null = null
    let productBId: string | null = null

    try {
      token = await getAuthToken(request)

      categoryAId = await createCategoryFixture(request, token, { name: `QA Cat A ${suffix}` })
      categoryBId = await createCategoryFixture(request, token, { name: `QA Cat B ${suffix}` })

      productAId = await createProductFixture(request, token, {
        title: `QA Filter CatA ${suffix}`,
        sku: `QA-CAT-020-A-${suffix}`,
      })
      productBId = await createProductFixture(request, token, {
        title: `QA Filter CatB ${suffix}`,
        sku: `QA-CAT-020-B-${suffix}`,
      })

      await apiRequest(request, 'PUT', '/api/catalog/products', {
        token,
        data: { id: productAId, categoryIds: [categoryAId] },
      })
      await apiRequest(request, 'PUT', '/api/catalog/products', {
        token,
        data: { id: productBId, categoryIds: [categoryBId] },
      })

      const filterResponse = await apiRequest(
        request,
        'GET',
        `/api/catalog/products?categoryIds=${categoryAId}&page=1&pageSize=50`,
        { token },
      )
      expect(filterResponse.ok()).toBeTruthy()
      const body = (await filterResponse.json()) as { items?: Array<{ id: string }> }

      const returnedIds = (body.items ?? []).map((p) => p.id)
      expect(returnedIds).toContain(productAId)
      expect(returnedIds).not.toContain(productBId)
    } finally {
      await deleteCatalogProductIfExists(request, token, productAId)
      await deleteCatalogProductIfExists(request, token, productBId)
      await deleteCatalogCategoryIfExists(request, token, categoryAId)
      await deleteCatalogCategoryIfExists(request, token, categoryBId)
    }
  })

  test('should filter products by tag', async ({ request }) => {
    const suffix = Date.now()
    const tagName = `qa-tag-${suffix}`
    let token: string | null = null
    let productWithTagId: string | null = null
    let productWithoutTagId: string | null = null

    try {
      token = await getAuthToken(request)

      productWithTagId = await createProductFixture(request, token, {
        title: `QA Tagged ${suffix}`,
        sku: `QA-CAT-020-TAG-${suffix}`,
      })
      productWithoutTagId = await createProductFixture(request, token, {
        title: `QA Untagged ${suffix}`,
        sku: `QA-CAT-020-NOTAG-${suffix}`,
      })

      await apiRequest(request, 'PUT', '/api/catalog/products', {
        token,
        data: { id: productWithTagId, tags: [tagName] },
      })

      // Fetch the product to get the assigned tag UUID (API filters by tagIds, not tag name)
      const productRes = await apiRequest(
        request,
        'GET',
        `/api/catalog/products?id=${productWithTagId}&page=1&pageSize=1`,
        { token },
      )
      expect(productRes.ok()).toBeTruthy()
      const productBody = (await productRes.json()) as {
        items?: Array<{ tags?: Array<{ id: string }> ; tagAssignments?: Array<{ tag?: { id: string } }> }>
      }
      const product = productBody.items?.[0]
      const tagId = product?.tags?.[0]?.id ?? product?.tagAssignments?.[0]?.tag?.id

      // If we can't resolve a tag UUID, fall back to listing tags by name
      let resolvedTagId = tagId
      if (!resolvedTagId) {
        const tagsRes = await apiRequest(request, 'GET', `/api/catalog/tags?page=1&pageSize=50&search=${encodeURIComponent(tagName)}`, { token })
        if (tagsRes.ok()) {
          const tagsBody = (await tagsRes.json()) as { items?: Array<{ id: string; label?: string; name?: string }> }
          const match = (tagsBody.items ?? []).find((t) => t.label === tagName || t.name === tagName)
          resolvedTagId = match?.id
        }
      }
      expect(resolvedTagId, 'Should resolve tag UUID').toBeTruthy()

      const filterResponse = await apiRequest(
        request,
        'GET',
        `/api/catalog/products?tagIds=${resolvedTagId}&page=1&pageSize=50`,
        { token },
      )
      expect(filterResponse.ok()).toBeTruthy()
      const body = (await filterResponse.json()) as { items?: Array<{ id: string }> }

      const returnedIds = (body.items ?? []).map((p) => p.id)
      expect(returnedIds).toContain(productWithTagId)
      expect(returnedIds).not.toContain(productWithoutTagId)
    } finally {
      await deleteCatalogProductIfExists(request, token, productWithTagId)
      await deleteCatalogProductIfExists(request, token, productWithoutTagId)
    }
  })

  test('should filter products by is_active status', async ({ request }) => {
    const suffix = Date.now()
    let token: string | null = null
    let activeProductId: string | null = null
    let inactiveProductId: string | null = null

    try {
      token = await getAuthToken(request)

      activeProductId = await createProductFixture(request, token, {
        title: `QA Active ${suffix}`,
        sku: `QA-CAT-020-ACT-${suffix}`,
      })
      inactiveProductId = await createProductFixture(request, token, {
        title: `QA Inactive ${suffix}`,
        sku: `QA-CAT-020-INACT-${suffix}`,
      })

      await apiRequest(request, 'PUT', '/api/catalog/products', {
        token,
        data: { id: inactiveProductId, isActive: false },
      })

      const activeResponse = await apiRequest(
        request,
        'GET',
        '/api/catalog/products?isActive=true&page=1&pageSize=50',
        { token },
      )
      expect(activeResponse.ok()).toBeTruthy()
      const activeBody = (await activeResponse.json()) as { items?: Array<{ id: string }> }

      const activeIds = (activeBody.items ?? []).map((p) => p.id)
      expect(activeIds).toContain(activeProductId)
      expect(activeIds).not.toContain(inactiveProductId)
    } finally {
      await deleteCatalogProductIfExists(request, token, activeProductId)
      await deleteCatalogProductIfExists(request, token, inactiveProductId)
    }
  })

  test('should combine category and status filters', async ({ request }) => {
    const suffix = Date.now()
    let token: string | null = null
    let categoryId: string | null = null
    let activeCatProductId: string | null = null
    let inactiveCatProductId: string | null = null
    let activeNoCatProductId: string | null = null

    try {
      token = await getAuthToken(request)

      categoryId = await createCategoryFixture(request, token, { name: `QA Combo Cat ${suffix}` })

      activeCatProductId = await createProductFixture(request, token, {
        title: `QA Combo Active ${suffix}`,
        sku: `QA-CAT-020-COMBO-A-${suffix}`,
      })
      inactiveCatProductId = await createProductFixture(request, token, {
        title: `QA Combo Inactive ${suffix}`,
        sku: `QA-CAT-020-COMBO-I-${suffix}`,
      })
      activeNoCatProductId = await createProductFixture(request, token, {
        title: `QA Combo NoCat ${suffix}`,
        sku: `QA-CAT-020-COMBO-N-${suffix}`,
      })

      await apiRequest(request, 'PUT', '/api/catalog/products', {
        token,
        data: { id: activeCatProductId, categoryIds: [categoryId] },
      })
      await apiRequest(request, 'PUT', '/api/catalog/products', {
        token,
        data: { id: inactiveCatProductId, categoryIds: [categoryId], isActive: false },
      })

      const comboResponse = await apiRequest(
        request,
        'GET',
        `/api/catalog/products?categoryIds=${categoryId}&isActive=true&page=1&pageSize=50`,
        { token },
      )
      expect(comboResponse.ok()).toBeTruthy()
      const comboBody = (await comboResponse.json()) as { items?: Array<{ id: string }> }

      const comboIds = (comboBody.items ?? []).map((p) => p.id)
      expect(comboIds).toContain(activeCatProductId)
      expect(comboIds).not.toContain(inactiveCatProductId)
      expect(comboIds).not.toContain(activeNoCatProductId)
    } finally {
      await deleteCatalogProductIfExists(request, token, activeCatProductId)
      await deleteCatalogProductIfExists(request, token, inactiveCatProductId)
      await deleteCatalogProductIfExists(request, token, activeNoCatProductId)
      await deleteCatalogCategoryIfExists(request, token, categoryId)
    }
  })
})
