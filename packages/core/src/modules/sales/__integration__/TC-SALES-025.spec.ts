import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { deleteSalesEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/salesFixtures'

test.describe('TC-SALES-025: Delivery windows CRUD API', () => {
  test('should create, list, update, and delete a delivery window', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let windowId: string | null = null

    try {
      // Create
      const createResponse = await apiRequest(request, 'POST', '/api/sales/delivery-windows', {
        token,
        data: {
          name: `QA Window ${stamp}`,
          code: `qa-window-${stamp}`,
          description: 'Phase 4 coverage',
          leadTimeDays: 3,
          cutoffTime: '14:00',
          timezone: 'UTC',
          isActive: true,
        },
      })
      expect(createResponse.status(), 'POST /api/sales/delivery-windows should return 201').toBe(201)
      const createBody = await readJsonSafe<{ id?: string }>(createResponse)
      windowId = typeof createBody?.id === 'string' ? createBody.id : null
      expect(windowId, 'Create response should include id').toBeTruthy()

      // List
      const listResponse = await apiRequest(request, 'GET', '/api/sales/delivery-windows', { token })
      expect(listResponse.status()).toBe(200)
      const listBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(listResponse)
      expect(listBody?.items?.some((item) => item.id === windowId)).toBe(true)

      // Update
      const updateResponse = await apiRequest(request, 'PUT', '/api/sales/delivery-windows', {
        token,
        data: {
          id: windowId,
          name: `QA Window ${stamp} Updated`,
          leadTimeDays: 5,
          isActive: false,
        },
      })
      expect(updateResponse.status(), 'PUT /api/sales/delivery-windows should return 200').toBe(200)

      // Verify update
      const verifyResponse = await apiRequest(request, 'GET', '/api/sales/delivery-windows?isActive=false', { token })
      const verifyBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(verifyResponse)
      const updated = verifyBody?.items?.find((item) => item.id === windowId)
      expect(updated?.name).toBe(`QA Window ${stamp} Updated`)
      expect(updated?.leadTimeDays).toBe(5)

      // Delete
      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/sales/delivery-windows?id=${encodeURIComponent(windowId!)}`,
        { token },
      )
      expect(deleteResponse.status(), 'DELETE /api/sales/delivery-windows should return 200').toBe(200)
      windowId = null
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/delivery-windows', windowId)
    }
  })
})
