import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

test.describe('TC-SALES-024: Status dictionary CRUD APIs (shipment, order, order-line)', () => {
  const STATUS_ROUTES = [
    { name: 'shipment-statuses', path: '/api/sales/shipment-statuses' },
    { name: 'order-statuses', path: '/api/sales/order-statuses' },
    { name: 'order-line-statuses', path: '/api/sales/order-line-statuses' },
  ] as const

  for (const route of STATUS_ROUTES) {
    test(`should create, list, update, and delete a ${route.name} entry`, async ({ request }) => {
      const token = await getAuthToken(request, 'admin')
      const stamp = Date.now()
      const value = `qa-status-${stamp}`
      let entryId: string | null = null

      try {
        // Create
        const createResponse = await apiRequest(request, 'POST', route.path, {
          token,
          data: { value, label: `QA ${route.name} ${stamp}`, color: '#ff0000' },
        })
        expect(createResponse.status(), `POST ${route.path} should return 201`).toBe(201)
        const createBody = await readJsonSafe<{ id?: string }>(createResponse)
        entryId = typeof createBody?.id === 'string' ? createBody.id : null
        expect(entryId, 'Create response should include id').toBeTruthy()

        // List
        const listResponse = await apiRequest(request, 'GET', route.path, { token })
        expect(listResponse.status(), `GET ${route.path} should return 200`).toBe(200)
        const listBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(listResponse)
        expect(listBody?.items?.some((item) => item.id === entryId)).toBe(true)

        // Update
        const updateResponse = await apiRequest(request, 'PUT', route.path, {
          token,
          data: { id: entryId, label: `QA ${route.name} Updated`, color: '#00ff00' },
        })
        expect(updateResponse.status(), `PUT ${route.path} should return 200`).toBe(200)

        // Verify update
        const verifyResponse = await apiRequest(request, 'GET', route.path, { token })
        const verifyBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(verifyResponse)
        const updated = verifyBody?.items?.find((item) => item.id === entryId)
        expect(updated?.label).toBe(`QA ${route.name} Updated`)

        // Delete
        const deleteResponse = await apiRequest(
          request,
          'DELETE',
          `${route.path}?id=${encodeURIComponent(entryId!)}`,
          { token },
        )
        expect(deleteResponse.status(), `DELETE ${route.path} should return 200`).toBe(200)
        entryId = null
      } finally {
        if (entryId) {
          await apiRequest(request, 'DELETE', `${route.path}?id=${encodeURIComponent(entryId)}`, { token }).catch(() => undefined)
        }
      }
    })
  }
})
