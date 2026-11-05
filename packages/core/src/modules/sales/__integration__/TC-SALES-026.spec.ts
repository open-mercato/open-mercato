import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { createSalesOrderFixture, deleteSalesEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/salesFixtures'

test.describe('TC-SALES-026: Notes CRUD API', () => {
  test('should create, list, update, and delete a note attached to an order', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let orderId: string | null = null
    let noteId: string | null = null

    try {
      orderId = await createSalesOrderFixture(request, token)

      // Create note
      const createResponse = await apiRequest(request, 'POST', '/api/sales/notes', {
        token,
        data: {
          contextType: 'order',
          contextId: orderId,
          body: `QA note body ${stamp}`,
        },
      })
      expect(createResponse.status(), 'POST /api/sales/notes should return 201').toBe(201)
      const createBody = await readJsonSafe<{ id?: string }>(createResponse)
      noteId = typeof createBody?.id === 'string' ? createBody.id : null
      expect(noteId, 'Note creation should return id').toBeTruthy()

      // List notes for the order
      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/sales/notes?contextType=order&contextId=${encodeURIComponent(orderId)}`,
        { token },
      )
      expect(listResponse.status()).toBe(200)
      const listBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(listResponse)
      expect(listBody?.items?.some((item) => item.id === noteId)).toBe(true)

      // Update note
      const updateResponse = await apiRequest(request, 'PUT', '/api/sales/notes', {
        token,
        data: {
          id: noteId,
          body: `QA note body ${stamp} updated`,
        },
      })
      expect(updateResponse.status(), 'PUT /api/sales/notes should return 200').toBe(200)

      // Verify update
      const verifyResponse = await apiRequest(
        request,
        'GET',
        `/api/sales/notes?contextType=order&contextId=${encodeURIComponent(orderId)}`,
        { token },
      )
      const verifyBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(verifyResponse)
      const updated = verifyBody?.items?.find((item) => item.id === noteId)
      expect(updated?.body).toBe(`QA note body ${stamp} updated`)

      // Delete note
      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/sales/notes?id=${encodeURIComponent(noteId!)}`,
        { token },
      )
      expect(deleteResponse.status(), 'DELETE /api/sales/notes should return 200').toBe(200)
      noteId = null
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/notes', noteId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })
})
