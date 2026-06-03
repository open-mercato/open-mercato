import { expect, test, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'

type JsonRecord = Record<string, unknown>
const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'

async function readJson(response: APIResponse): Promise<JsonRecord> {
  return ((await readJsonSafe<JsonRecord>(response)) ?? {}) as JsonRecord
}

/**
 * TC-DS-003: Data sync options endpoint smoke test
 *
 * Regression coverage for issue #8: GET /api/data_sync/options must not return a
 * 500 when a single integration's credential or state resolution fails (e.g. an
 * unconfigured encryption key on a tenant). The endpoint resolves each
 * integration fail-soft, so the list still returns 200 with the expected shape.
 */
test.describe('TC-DS-003: Data sync options endpoint', () => {
  test('authorization is enforced for options endpoint', async ({ request }) => {
    const noTokenResponse = await request.get(`${BASE_URL}/api/data_sync/options`)
    expect(noTokenResponse.status()).toBe(401)

    // /api/data_sync/options is a read-only listing gated by the `data_sync.view`
    // feature. The seeded `employee` role holds `data_sync.view` (see the module's
    // setup.ts defaultRoleFeatures), so it is intentionally allowed here — unlike
    // the write/configure endpoints in TC-DS-001 (`data_sync.run`) and TC-DS-002
    // (`data_sync.configure`), which employee does not hold and which return 403.
    const employeeToken = await getAuthToken(request, 'employee')
    const allowedResponse = await apiRequest(request, 'GET', '/api/data_sync/options', {
      token: employeeToken,
    })
    expect(allowedResponse.status()).toBe(200)
  })

  test('returns 200 with a well-formed items array', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const response = await apiRequest(request, 'GET', '/api/data_sync/options', { token })
    expect(
      response.status(),
      `Expected 200 from /api/data_sync/options, got ${response.status()}: ${(await response.text()).slice(0, 2000)}`,
    ).toBe(200)

    const body = await readJson(response)
    expect(Array.isArray(body.items)).toBe(true)

    const items = body.items as JsonRecord[]
    for (const item of items) {
      expect(typeof item.integrationId).toBe('string')
      expect(typeof item.providerKey).toBe('string')
      expect(['import', 'export']).toContain(item.direction)
      expect(typeof item.canStartRun).toBe('boolean')
      expect(Array.isArray(item.supportedEntities)).toBe(true)
      expect(typeof item.hasCredentials).toBe('boolean')
      expect(typeof item.isEnabled).toBe('boolean')
      expect(typeof item.settingsPath).toBe('string')
    }
  })
})
