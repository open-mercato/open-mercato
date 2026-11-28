import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-CAT-056: the category edit form clears a description (#10461)
 *
 * The form dropped a blank description from the update payload, so the save
 * reported success while the stored text came back after reload.
 */
test.describe('TC-CAT-056: category edit form clears a description', () => {
  test('a description cleared in the form stays empty after reload', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const name = `QA TC-CAT-056 Category ${stamp}`
    const description = `QA TC-CAT-056 description ${stamp}`
    let categoryId: string | null = null

    try {
      const created = await apiRequest(request, 'POST', '/api/catalog/categories', {
        token,
        data: { name, description },
      })
      expect(created.status(), 'POST /api/catalog/categories should return 201').toBe(201)
      const createdBody = await readJsonSafe<{ id?: string }>(created)
      categoryId = expectId(createdBody?.id, 'category create should return an id')

      const editPath = `/backend/catalog/categories/${encodeURIComponent(categoryId)}/edit`
      const nameInput = page.getByRole('textbox', { name: 'Name' })
      const descriptionInput = page.getByRole('textbox', { name: 'Description' })

      await login(page, 'admin')
      await page.goto(editPath, { waitUntil: 'domcontentloaded' })
      await expect(nameInput).toHaveValue(name)
      await expect(descriptionInput).toHaveValue(description)

      await descriptionInput.fill('')
      await page.getByRole('button', { name: 'Save', exact: true }).first().click()
      await expect(page).toHaveURL(/\/backend\/catalog\/categories(?:\?|$)/)

      await page.goto(editPath, { waitUntil: 'domcontentloaded' })
      await expect(nameInput).toHaveValue(name)
      await expect(descriptionInput).toHaveValue('')
    } finally {
      if (categoryId) {
        const deleted = await apiRequest(
          request,
          'DELETE',
          `/api/catalog/categories?id=${encodeURIComponent(categoryId)}`,
          { token },
        )
        expect(deleted.ok(), `category cleanup should succeed: ${deleted.status()}`).toBeTruthy()
      }
    }
  })
})
