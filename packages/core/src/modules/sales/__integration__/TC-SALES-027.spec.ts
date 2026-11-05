import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { deleteSalesEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/salesFixtures'

test.describe('TC-SALES-027: Sales tags CRUD API', () => {
  test('should create, list, update, and delete a sales tag', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let tagId: string | null = null

    try {
      // Create
      const createResponse = await apiRequest(request, 'POST', '/api/sales/tags', {
        token,
        data: {
          label: `QA Tag ${stamp}`,
          color: '#3366ff',
          description: 'Phase 4 tag coverage',
        },
      })
      expect(createResponse.status(), 'POST /api/sales/tags should return 201').toBe(201)
      const createBody = await readJsonSafe<{ id?: string }>(createResponse)
      tagId = typeof createBody?.id === 'string' ? createBody.id : null
      expect(tagId, 'Tag creation should return id').toBeTruthy()

      // List
      const listResponse = await apiRequest(request, 'GET', '/api/sales/tags', { token })
      expect(listResponse.status()).toBe(200)
      const listBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(listResponse)
      expect(listBody?.items?.some((item) => item.id === tagId)).toBe(true)

      // Update
      const updateResponse = await apiRequest(request, 'PUT', '/api/sales/tags', {
        token,
        data: {
          id: tagId,
          label: `QA Tag ${stamp} Updated`,
          color: '#ff3366',
        },
      })
      expect(updateResponse.status(), 'PUT /api/sales/tags should return 200').toBe(200)

      // Verify update
      const verifyResponse = await apiRequest(request, 'GET', '/api/sales/tags', { token })
      const verifyBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(verifyResponse)
      const updated = verifyBody?.items?.find((item) => item.id === tagId)
      expect(updated?.label).toBe(`QA Tag ${stamp} Updated`)

      // Delete
      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/sales/tags?id=${encodeURIComponent(tagId!)}`,
        { token },
      )
      expect(deleteResponse.status(), 'DELETE /api/sales/tags should return 200').toBe(200)
      tagId = null
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/tags', tagId)
    }
  })
})
