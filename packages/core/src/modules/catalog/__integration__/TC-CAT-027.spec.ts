import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCategoryFixture,
  deleteCatalogCategoryIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'

/**
 * TC-CAT-027: Categories LIST API — manage vs tree views.
 * Source: issue #2484 (catalog integration coverage), scenario TC-CAT-027.
 *
 * `GET /api/catalog/categories` has a custom handler with two shapes:
 *  - `view=manage` → paginated flat list; each item carries `parentId`,
 *    `childCount` and `descendantCount` computed over the full hierarchy.
 *  - `view=tree` → nested forest of root nodes, each with a `children` array.
 * Both envelopes are `{ items: [...] }`. Existing specs only exercise the
 * category CRUD/UI form, never the list API directly.
 */
test.describe('TC-CAT-027: Categories tree and manage views', () => {
  test('manage view returns parentId, childCount and descendantCount with correct hierarchy', async ({
    request,
  }) => {
    const suffix = Date.now()
    let token: string | null = null
    let parentId: string | null = null
    let childId: string | null = null

    try {
      token = await getAuthToken(request)

      parentId = await createCategoryFixture(request, token, { name: `QA Cat Parent ${suffix}` })

      const childRes = await apiRequest(request, 'POST', '/api/catalog/categories', {
        token,
        data: { name: `QA Cat Child ${suffix}`, parentId },
      })
      expect(childRes.ok(), `Failed to create child category: ${childRes.status()}`).toBeTruthy()
      childId = ((await childRes.json()) as { id?: string }).id ?? null
      expect(childId, 'Child category id is required').toBeTruthy()

      const manageRes = await apiRequest(
        request,
        'GET',
        `/api/catalog/categories?view=manage&search=${encodeURIComponent(String(suffix))}&page=1&pageSize=50`,
        { token },
      )
      expect(manageRes.ok(), `manage view failed: ${manageRes.status()}`).toBeTruthy()
      const manageBody = (await manageRes.json()) as {
        items?: Array<{
          id: string
          parentId: string | null
          childCount?: number
          descendantCount?: number
        }>
      }
      const items = manageBody.items ?? []

      const parentRow = items.find((item) => item.id === parentId)
      const childRow = items.find((item) => item.id === childId)

      expect(parentRow, 'Parent category should be present in manage view').toBeTruthy()
      expect(childRow, 'Child category should be present in manage view').toBeTruthy()

      // Flat list exposes the hierarchy via fields, not nesting.
      expect(childRow?.parentId).toBe(parentId)
      expect(parentRow?.childCount ?? 0).toBeGreaterThanOrEqual(1)
      expect(parentRow?.descendantCount ?? 0).toBeGreaterThanOrEqual(1)
    } finally {
      await deleteCatalogCategoryIfExists(request, token, childId)
      await deleteCatalogCategoryIfExists(request, token, parentId)
    }
  })

  test('tree view nests the child under its parent in a children array', async ({ request }) => {
    const suffix = Date.now()
    let token: string | null = null
    let parentId: string | null = null
    let childId: string | null = null

    try {
      token = await getAuthToken(request)

      parentId = await createCategoryFixture(request, token, { name: `QA Tree Parent ${suffix}` })

      const childRes = await apiRequest(request, 'POST', '/api/catalog/categories', {
        token,
        data: { name: `QA Tree Child ${suffix}`, parentId },
      })
      expect(childRes.ok(), `Failed to create child category: ${childRes.status()}`).toBeTruthy()
      childId = ((await childRes.json()) as { id?: string }).id ?? null
      expect(childId, 'Child category id is required').toBeTruthy()

      const treeRes = await apiRequest(request, 'GET', '/api/catalog/categories?view=tree', {
        token,
      })
      expect(treeRes.ok(), `tree view failed: ${treeRes.status()}`).toBeTruthy()
      const treeBody = (await treeRes.json()) as {
        items?: Array<{ id: string; children?: Array<{ id: string }> }>
      }
      const roots = treeBody.items ?? []

      // The newly created parent has no parent of its own, so it is a root node.
      const parentNode = roots.find((node) => node.id === parentId)
      expect(parentNode, 'Parent should appear as a root node in the tree').toBeTruthy()
      const nestedChildIds = (parentNode?.children ?? []).map((node) => node.id)
      expect(nestedChildIds).toContain(childId)
    } finally {
      await deleteCatalogCategoryIfExists(request, token, childId)
      await deleteCatalogCategoryIfExists(request, token, parentId)
    }
  })
})
