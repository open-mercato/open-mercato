import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

/**
 * TC-APIKEY-005: RBAC enforcement
 * Source: issue #2470
 *
 * A user without api_keys.* features must not be able to view, create, or delete
 * API keys. (The seeded `employee` role is granted no api_keys feature.)
 */
test.describe('TC-APIKEY-005: API key RBAC enforcement', () => {
  test('denies list to a user without api_keys.view', async ({ request }) => {
    const token = await getAuthToken(request, 'employee')
    const response = await apiRequest(request, 'GET', '/api/api_keys/keys', { token })
    expect(response.ok(), 'employee must not list API keys').toBe(false)
    expect([401, 403]).toContain(response.status())
  })

  test('denies create to a user without api_keys.create', async ({ request }) => {
    const token = await getAuthToken(request, 'employee')
    const response = await apiRequest(request, 'POST', '/api/api_keys/keys', {
      token,
      data: { name: `QA TC-APIKEY-005 ${Date.now()}` },
    })
    expect(response.ok(), 'employee must not create API keys').toBe(false)
    expect([401, 403]).toContain(response.status())
  })

  test('denies delete to a user without api_keys.delete', async ({ request }) => {
    const token = await getAuthToken(request, 'employee')
    // A random UUID — the request must be rejected by the guard before any lookup.
    const response = await apiRequest(request, 'DELETE', '/api/api_keys/keys?id=00000000-0000-4000-8000-000000000000', { token })
    expect(response.ok(), 'employee must not delete API keys').toBe(false)
    expect([401, 403]).toContain(response.status())
  })
})
