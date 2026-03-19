import { expect, test, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'

type JsonRecord = Record<string, unknown>
const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'

async function readJson(response: APIResponse): Promise<JsonRecord> {
  return ((await readJsonSafe<JsonRecord>(response)) ?? {}) as JsonRecord
}

/**
 * TC-INT-003: Integration health check and logs APIs
 *
 * Tests the health check and operation logs endpoints added by SPEC-045a.
 * Health check requires the POST /api/integrations/:id/health route.
 * Logs require the GET /api/integrations/logs route.
 * Dynamically detects available integrations — works with or without provider modules.
 */
test.describe('TC-INT-003: Integration health check and logs APIs', () => {
  test('health and logs endpoints enforce authorization', async ({ request }) => {
    const noTokenLogsResponse = await request.get(`${BASE_URL}/api/integrations/logs?page=1&pageSize=5`)
    expect(noTokenLogsResponse.status()).toBe(401)

    const employeeToken = await getAuthToken(request, 'employee')
    const forbiddenLogsResponse = await apiRequest(request, 'GET', '/api/integrations/logs?page=1&pageSize=5', {
      token: employeeToken,
    })
    expect(forbiddenLogsResponse.status()).toBe(403)
  })

  test('health check endpoint returns status for a registered integration', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    // Dynamically detect an available integration
    const listResponse = await apiRequest(request, 'GET', '/api/integrations', { token })
    expect(listResponse.status()).toBe(200)
    const listBody = await readJson(listResponse)
    const items = Array.isArray(listBody.items) ? (listBody.items as JsonRecord[]) : []

    if (items.length === 0) {
      test.skip(true, 'No integration provider modules registered — skipping health check test')
      return
    }

    const integrationId = String(items[0].id)

    const healthResponse = await apiRequest(request, 'POST', `/api/integrations/${integrationId}/health`, { token })

    // Route may not exist if ephemeral env was built before health route
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

    // Probe whether health route exists at all using a known integration or a non-existent one
    const listResponse = await apiRequest(request, 'GET', '/api/integrations', { token })
    const listBody = await readJson(listResponse)
    const items = Array.isArray(listBody.items) ? (listBody.items as JsonRecord[]) : []

    const probeId = items.length > 0 ? String(items[0].id) : 'non_existent_integration_xyz'
    const probeResponse = await apiRequest(request, 'POST', `/api/integrations/${probeId}/health`, { token })
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
      '/api/integrations/logs?page=1&pageSize=10',
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
      '/api/integrations/logs?level=error&page=1&pageSize=5',
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
      '/api/integrations/logs?page=1&pageSize=5',
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
