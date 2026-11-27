import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['wms'],
}

const malformedId = 'not-a-uuid'

type ValidationBody = { error?: string; details?: Array<{ path?: unknown[] }> }

const routes = [
  { path: `/api/wms/putaway-tasks/${malformedId}/assign`, paramKey: 'id' },
  { path: `/api/wms/putaway-tasks/${malformedId}/cancel`, paramKey: 'id' },
  { path: `/api/wms/putaway-tasks/${malformedId}/complete`, paramKey: 'id' },
  { path: `/api/wms/putaway-tasks/${malformedId}/start`, paramKey: 'id' },
  { path: `/api/wms/asns/${malformedId}/complete`, paramKey: 'id' },
  { path: `/api/wms/asns/${malformedId}/receive`, paramKey: 'id' },
  { path: `/api/wms/sales-orders/${malformedId}/re-run-reservation`, paramKey: 'salesOrderId' },
]

test.describe('TC-WMS-034: WMS custom POST routes reject a malformed path id with 400', () => {
  for (const { path, paramKey } of routes) {
    test(`POST ${path} returns 400`, async ({ request }) => {
      const token = await getAuthToken(request, 'admin')
      const response = await apiRequest(request, 'POST', path, { token, data: {} })
      const body = await readJsonSafe<ValidationBody>(response)

      expect(response.status(), `POST ${path}`).toBe(400)
      expect(body?.error).toBe('Validation failed')
      expect(body?.details?.map((issue) => issue.path)).toEqual([[paramKey]])
    })
  }

  test('answers the malformed id error in the requested language', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'POST', routes[0].path, {
      token,
      data: {},
      headers: { 'Accept-Language': 'pl' },
    })
    const body = await readJsonSafe<ValidationBody>(response)

    expect(response.status()).toBe(400)
    expect(body?.error).toBe('Walidacja nie powiodła się')
  })

  test('an unauthenticated malformed id is still rejected with 401', async () => {
    const status = await withCredentialIsolatedRequest(async (isolatedRequest) => {
      const response = await isolatedRequest.post(routes[0].path, { data: {} })
      return response.status()
    })
    expect(status).toBe(401)
  })
})
