import { expect, test } from '@playwright/test'
import {
  apiRequest,
  getAuthToken,
} from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import {
  createCategoryFixture,
  deleteCatalogCategoryIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'

/**
 * TC-CAT-016: Category Edit and Delete
 * Source: SPEC-050 Phase 3, Step 3.1
 */
test.describe('TC-CAT-016: Category Edit and Delete', () => {
  test('should navigate to edit page, update category name, save, and verify in list', async ({
    page,
    request,
  }) => {
    const stamp = Date.now()
    const originalName = `QA TC-CAT-016 Original ${stamp}`
    const updatedName = `QA TC-CAT-016 Updated ${stamp}`
    let token: string | null = null
    let categoryId: string | null = null

    try {
      token = await getAuthToken(request)
      categoryId = await createCategoryFixture(request, token, { name: originalName })

      await login(page, 'admin')
      await page.goto(`/backend/catalog/categories/${categoryId}/edit`, { waitUntil: 'domcontentloaded' })

      const nameField = page.getByRole('textbox', { name: 'e.g., Footwear' })
      await expect(nameField).toBeVisible()
      await nameField.clear()
      await nameField.fill(updatedName)

      const saveResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === 'PUT' &&
          /\/api\/catalog\/categories(?:\?|$)/.test(response.url()),
        { timeout: 10_000 },
      )
      await page.getByRole('button', { name: /Save/i }).first().click()
      const saveResponse = await saveResponsePromise
      expect(saveResponse.ok(), `Category update failed with ${saveResponse.status()}`).toBeTruthy()

      await page.goto('/backend/catalog/categories', { waitUntil: 'domcontentloaded' })
      await expect(page.getByText(updatedName).first()).toBeVisible()
    } finally {
      await deleteCatalogCategoryIfExists(request, token, categoryId)
    }
  })

  test('should delete category and confirm removal from list', async ({
    request,
  }) => {
    const stamp = Date.now()
    const categoryName = `QA TC-CAT-016 Delete ${stamp}`
    let token: string | null = null
    let categoryId: string | null = null

    try {
      token = await getAuthToken(request)
      categoryId = await createCategoryFixture(request, token, { name: categoryName })

      // Verify category exists before deletion
      const listBefore = await apiRequest(request, 'GET', `/api/catalog/categories?page=1&pageSize=100`, { token })
      expect(listBefore.ok()).toBeTruthy()
      const beforeBody = (await listBefore.json()) as { items?: Array<{ id: string }> }
      expect((beforeBody.items ?? []).some((item) => item.id === categoryId), 'Category should exist before deletion').toBeTruthy()

      // Delete via API
      const deleteResponse = await apiRequest(request, 'DELETE', `/api/catalog/categories?id=${encodeURIComponent(categoryId!)}`, { token })
      expect(deleteResponse.ok(), `Delete failed with ${deleteResponse.status()}`).toBeTruthy()

      // Verify category no longer appears in list
      const listAfter = await apiRequest(request, 'GET', `/api/catalog/categories?page=1&pageSize=100`, { token })
      expect(listAfter.ok()).toBeTruthy()
      const afterBody = (await listAfter.json()) as { items?: Array<{ id: string }> }
      expect((afterBody.items ?? []).some((item) => item.id === categoryId), 'Category should not exist after deletion').toBeFalsy()

      categoryId = null
    } finally {
      await deleteCatalogCategoryIfExists(request, token, categoryId)
    }
  })

  test('should handle deletion of a parent category with children', async ({
    request,
  }) => {
    const stamp = Date.now()
    const parentName = `QA TC-CAT-016 Parent ${stamp}`
    const childName = `QA TC-CAT-016 Child ${stamp}`
    let token: string | null = null
    let parentId: string | null = null
    let childId: string | null = null

    try {
      token = await getAuthToken(request)
      parentId = await createCategoryFixture(request, token, { name: parentName })

      const childResponse = await apiRequest(request, 'POST', '/api/catalog/categories', {
        token,
        data: { name: childName, parentId },
      })
      expect(
        childResponse.ok(),
        `Failed to create child category: ${childResponse.status()}`,
      ).toBeTruthy()
      const childBody = (await childResponse.json()) as { id?: string }
      expect(typeof childBody.id === 'string' && childBody.id.length > 0).toBeTruthy()
      childId = childBody.id as string

      const deleteParentResponse = await apiRequest(
        request,
        'DELETE',
        `/api/catalog/categories?id=${encodeURIComponent(parentId)}`,
        { token },
      )

      const deleteStatus = deleteParentResponse.status()

      if (deleteStatus >= 400) {
        expect(
          [400, 409, 422].includes(deleteStatus),
          `Expected a client error status when deleting parent with children, got ${deleteStatus}`,
        ).toBeTruthy()
      } else {
        expect(deleteParentResponse.ok()).toBeTruthy()

        const childGetResponse = await apiRequest(
          request,
          'GET',
          `/api/catalog/categories?id=${encodeURIComponent(childId)}`,
          { token },
        )

        if (childGetResponse.ok()) {
          const childGetBody = (await childGetResponse.json()) as {
            parentId?: string | null
            parent_id?: string | null
            items?: Array<{ id: string; parentId?: string | null; parent_id?: string | null }>
          }
          const childRecord =
            childGetBody.items?.find((item) => item.id === childId) ?? childGetBody
          const resolvedParentId = childRecord.parentId ?? childRecord.parent_id
          expect(
            resolvedParentId === null || resolvedParentId === undefined,
            'Child category should become a root category after parent deletion',
          ).toBeTruthy()
        }

        parentId = null
      }
    } finally {
      await deleteCatalogCategoryIfExists(request, token, childId)
      await deleteCatalogCategoryIfExists(request, token, parentId)
    }
  })
})
