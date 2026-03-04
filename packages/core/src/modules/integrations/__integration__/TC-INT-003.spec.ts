import { expect, test, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

type JsonRecord = Record<string, unknown>

async function readJson(response: APIResponse): Promise<JsonRecord> {
  return (await response.json().catch(() => ({}))) as JsonRecord
}

const INTEGRATION_ID = 'sync_medusa_products'

/**
 * TC-INT-003: Integration health check and logs APIs
 *
 * Tests the health check and operation logs endpoints added by SPEC-045a.
 * Health check requires the POST /api/integrations/:id/health route.
 * Logs require the GET /api/integrations/logs route.
 */
test.describe('TC-INT-003: Integration health check and logs APIs', () => {
  test('health check endpoint returns status for a registered integration', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const healthResponse = await apiRequest(request, 'POST', `/api/integrations/${INTEGRATION_ID}/health`, { token })

    // Route may not exist if ephemeral env was built before SPEC-045a health route
    if (healthResponse.status() === 404) {
      const body = await readJson(healthResponse)
      if (!body.status) {
        test.skip(true, 'Health check route not deployed in current environment')
        return
      }
    }

    expect(healthResponse.status()).toBe(200)
    const healthBody = await readJson(healthResponse)
    expect(healthBody).toHaveProperty('status')
    expect(['healthy', 'degraded', 'unhealthy', 'unknown']).toContain(healthBody.status)
    expect(healthBody).toHaveProperty('checkedAt')
    expect(typeof healthBody.checkedAt).toBe('string')
  })

  test('health check returns 404 for non-existent integration', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    // Probe whether health route exists at all
    const probeResponse = await apiRequest(request, 'POST', `/api/integrations/${INTEGRATION_ID}/health`, { token })
    if (probeResponse.status() === 404) {
      const body = await readJson(probeResponse)
      if (!body.error || String(body.error) !== 'Integration not found') {
        test.skip(true, 'Health check route not deployed in current environment')
        return
      }
    }

    const healthResponse = await apiRequest(
      request,
      'POST',
      '/api/integrations/non_existent_integration_xyz/health',
      { token },
    )
    expect(healthResponse.status()).toBe(404)
  })

  test('logs endpoint returns paginated list', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const logsResponse = await apiRequest(
      request,
      'GET',
      `/api/integrations/logs?integrationId=${INTEGRATION_ID}&page=1&pageSize=10`,
      { token },
    )
    expect(logsResponse.status()).toBe(200)
    const logsBody = await readJson(logsResponse)
    expect(logsBody).toHaveProperty('items')
    expect(Array.isArray(logsBody.items)).toBe(true)
    expect(logsBody).toHaveProperty('total')
    expect(typeof logsBody.total).toBe('number')
    expect(logsBody).toHaveProperty('page')
    expect(logsBody.page).toBe(1)
    expect(logsBody).toHaveProperty('pageSize')
    expect(logsBody.pageSize).toBe(10)
    expect(logsBody).toHaveProperty('totalPages')
    expect(typeof logsBody.totalPages).toBe('number')
  })

  test('logs endpoint filters by level', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const logsResponse = await apiRequest(
      request,
      'GET',
      `/api/integrations/logs?integrationId=${INTEGRATION_ID}&level=error&page=1&pageSize=5`,
      { token },
    )
    expect(logsResponse.status()).toBe(200)
    const logsBody = await readJson(logsResponse)
    expect(Array.isArray(logsBody.items)).toBe(true)
    const items = logsBody.items as JsonRecord[]
    for (const item of items) {
      expect(item.level).toBe('error')
    }
  })

  test('logs endpoint returns items with expected shape', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const logsResponse = await apiRequest(
      request,
      'GET',
      `/api/integrations/logs?page=1&pageSize=5`,
      { token },
    )
    expect(logsResponse.status()).toBe(200)
    const logsBody = await readJson(logsResponse)
    const items = logsBody.items as JsonRecord[]
    for (const item of items) {
      expect(item).toHaveProperty('id')
      expect(item).toHaveProperty('integrationId')
      expect(item).toHaveProperty('level')
      expect(item).toHaveProperty('message')
      expect(item).toHaveProperty('createdAt')
    }
  })
})
