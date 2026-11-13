import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['wms'],
}

const malformedId = 'not-a-uuid'

const routes = [
  `/api/wms/putaway-tasks/${malformedId}/assign`,
  `/api/wms/putaway-tasks/${malformedId}/cancel`,
  `/api/wms/putaway-tasks/${malformedId}/complete`,
  `/api/wms/putaway-tasks/${malformedId}/start`,
  `/api/wms/asns/${malformedId}/complete`,
  `/api/wms/asns/${malformedId}/receive`,
  `/api/wms/sales-orders/${malformedId}/re-run-reservation`,
]

test.describe('TC-WMS-034: WMS custom POST routes reject a malformed path id with 400', () => {
  for (const path of routes) {
    test(`POST ${path} returns 400`, async ({ request }) => {
      const token = await getAuthToken(request, 'admin')
      const response = await apiRequest(request, 'POST', path, { token, data: {} })
      const body = await readJsonSafe<{ error?: string; details?: unknown[] }>(response)

      expect(response.status(), `POST ${path}`).toBe(400)
      expect(body?.error).toBe('Validation failed')
      expect(Array.isArray(body?.details)).toBe(true)
    })
  }

  test('an unauthenticated malformed id is still rejected with 401', async () => {
    const status = await withCredentialIsolatedRequest(async (isolatedRequest) => {
      const response = await isolatedRequest.post(routes[0], { data: {} })
      return response.status()
    })
    expect(status).toBe(401)
  })
})
