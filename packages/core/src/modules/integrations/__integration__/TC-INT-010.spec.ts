import { expect, request as playwrightRequest, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'

type JsonRecord = Record<string, unknown>
const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'

async function readJson(response: APIResponse): Promise<JsonRecord> {
  return ((await readJsonSafe<JsonRecord>(response)) ?? {}) as JsonRecord
}

async function pickIntegrationId(request: APIRequestContext, token: string): Promise<string | null> {
  const listResponse = await apiRequest(request, 'GET', '/api/integrations', { token })
  if (listResponse.status() !== 200) return null
  const body = await readJson(listResponse)
  const items = Array.isArray(body.items) ? (body.items as JsonRecord[]) : []
  return items.length > 0 ? String(items[0].id) : null
}

/**
 * TC-INT-010: Employee vs Admin RBAC — view vs manage permissions [P1]
 *
 * Surfaces: GET /api/integrations, GET/PUT /api/integrations/:id/credentials,
 * PUT /api/integrations/:id/state, PUT /api/integrations/:id/version,
 * POST /api/integrations/:id/health
 *
 * The seeded employee role is granted integrations.view only; admin holds
 * integrations.* . Manage-gated routes (state/version/credentials/health) must
 * reject the employee with 403 while admin is authorized. A missing token yields
 * 401, distinct from the authenticated-but-unauthorized 403.
 */
test.describe('TC-INT-010: Integration RBAC view vs manage', () => {
  test('employee may view but cannot manage; admin is authorized', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    const integrationId = await pickIntegrationId(request, adminToken)
    if (!integrationId) {
      test.skip(true, 'No integration provider modules registered — skipping RBAC checks')
      return
    }

    // View is granted to the employee.
    const employeeList = await apiRequest(request, 'GET', '/api/integrations', { token: employeeToken })
    expect(employeeList.status(), 'employee should be able to list integrations').toBe(200)

    // Manage-gated reads/writes are forbidden for the employee.
    const manageGatedRequests: Array<{ label: string; response: APIResponse }> = [
      {
        label: 'GET credentials',
        response: await apiRequest(request, 'GET', `/api/integrations/${integrationId}/credentials`, { token: employeeToken }),
      },
      {
        label: 'PUT credentials',
        response: await apiRequest(request, 'PUT', `/api/integrations/${integrationId}/credentials`, {
          token: employeeToken,
          data: { credentials: {} },
        }),
      },
      {
        label: 'PUT state',
        response: await apiRequest(request, 'PUT', `/api/integrations/${integrationId}/state`, {
          token: employeeToken,
          data: { isEnabled: true },
        }),
      },
      {
        label: 'PUT version',
        response: await apiRequest(request, 'PUT', `/api/integrations/${integrationId}/version`, {
          token: employeeToken,
          data: { apiVersion: 'any' },
        }),
      },
      {
        label: 'POST health',
        response: await apiRequest(request, 'POST', `/api/integrations/${integrationId}/health`, { token: employeeToken }),
      },
    ]
    for (const { label, response } of manageGatedRequests) {
      expect(response.status(), `employee ${label} should be forbidden`).toBe(403)
    }

    // Admin clears the manage gate (read paths are authorized; 200 normally, 503 only if encryption is unavailable).
    const adminCredentials = await apiRequest(request, 'GET', `/api/integrations/${integrationId}/credentials`, { token: adminToken })
    expect(adminCredentials.status(), 'admin should not be forbidden from reading credentials').not.toBe(403)
    expect([200, 503]).toContain(adminCredentials.status())
  })

  test('distinguishes 401 (no token) from 403 (insufficient feature)', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    const integrationId = await pickIntegrationId(request, adminToken)
    if (!integrationId) {
      test.skip(true, 'No integration provider modules registered — skipping auth distinction checks')
      return
    }

    const anonymous = await playwrightRequest.newContext({ baseURL: BASE_URL })
    try {
      const noToken = await anonymous.get(`/api/integrations/${integrationId}/credentials`)
      expect(noToken.status(), 'unauthenticated credentials read should be 401').toBe(401)
    } finally {
      await anonymous.dispose()
    }

    const employee = await apiRequest(request, 'GET', `/api/integrations/${integrationId}/credentials`, { token: employeeToken })
    expect(employee.status(), 'authenticated-but-unauthorized credentials read should be 403').toBe(403)
  })
})
