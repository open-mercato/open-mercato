import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'

/**
 * TC-CAT-031: Tag filtering with multiple tagIds.
 * Source: issue #2484 (catalog integration coverage), scenario TC-CAT-031.
 *
 * Products are written with tag *labels* (`tags: [...]`) but the list API
 * filters by tag *UUIDs* (`?tagIds=a,b`), so a label→UUID round-trip via
 * `/api/catalog/tags?search=` is required. Multiple `tagIds` are combined as a
 * UNION (a product matching ANY listed tag is returned) — not an intersection.
 * TC-CAT-020 only covers the single-tag case.
 */
async function resolveTagId(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  label: string,
): Promise<string> {
  const res = await apiRequest(
    request,
    'GET',
    `/api/catalog/tags?page=1&pageSize=50&search=${encodeURIComponent(label)}`,
    { token },
  )
  expect(res.ok(), `Failed to list tags: ${res.status()}`).toBeTruthy()
  const body = (await res.json()) as { items?: Array<{ id: string; label?: string }> }
  const match = (body.items ?? []).find((tag) => tag.label === label)
  expect(match?.id, `Should resolve tag UUID for "${label}"`).toBeTruthy()
  return match!.id
}

test.describe('TC-CAT-031: Multi-tag product filtering', () => {
  test('filters by single and multiple tagIds (union semantics)', async ({ request }) => {
    const suffix = Date.now()
    const tagA = `qa-tag-a-${suffix}`
    const tagB = `qa-tag-b-${suffix}`
    let token: string | null = null
    let productBothId: string | null = null
    let productAId: string | null = null
    let productNoneId: string | null = null

    try {
      token = await getAuthToken(request)

      productBothId = await createProductFixture(request, token, {
        title: `QA Tags Both ${suffix}`,
        sku: `QA-CAT-031-BOTH-${suffix}`,
      })
      productAId = await createProductFixture(request, token, {
        title: `QA Tags A ${suffix}`,
        sku: `QA-CAT-031-A-${suffix}`,
      })
      productNoneId = await createProductFixture(request, token, {
        title: `QA Tags None ${suffix}`,
        sku: `QA-CAT-031-NONE-${suffix}`,
      })

      await apiRequest(request, 'PUT', '/api/catalog/products', {
        token,
        data: { id: productBothId, tags: [tagA, tagB] },
      })
      await apiRequest(request, 'PUT', '/api/catalog/products', {
        token,
        data: { id: productAId, tags: [tagA] },
      })

      const tagAId = await resolveTagId(request, token, tagA)
      const tagBId = await resolveTagId(request, token, tagB)

      const idsFor = async (queryTagIds: string): Promise<string[]> => {
        const res = await apiRequest(
          request,
          'GET',
          `/api/catalog/products?tagIds=${queryTagIds}&page=1&pageSize=50`,
          { token: token as string },
        )
        expect(res.ok(), `Tag filter failed: ${res.status()}`).toBeTruthy()
        const body = (await res.json()) as { items?: Array<{ id: string }> }
        return (body.items ?? []).map((item) => item.id)
      }

      // Single tag A → both the two-tag product and the A-only product.
      const byA = await idsFor(tagAId)
      expect(byA).toContain(productBothId)
      expect(byA).toContain(productAId)
      expect(byA).not.toContain(productNoneId)

      // Single tag B → only the two-tag product.
      const byB = await idsFor(tagBId)
      expect(byB).toContain(productBothId)
      expect(byB).not.toContain(productAId)
      expect(byB).not.toContain(productNoneId)

      // Both tags → union: the two-tag product AND the A-only product.
      const byBoth = await idsFor(`${tagAId},${tagBId}`)
      expect(byBoth).toContain(productBothId)
      expect(byBoth).toContain(productAId)
      expect(byBoth).not.toContain(productNoneId)
    } finally {
      await deleteCatalogProductIfExists(request, token, productBothId)
      await deleteCatalogProductIfExists(request, token, productAId)
      await deleteCatalogProductIfExists(request, token, productNoneId)
    }
  })
})
