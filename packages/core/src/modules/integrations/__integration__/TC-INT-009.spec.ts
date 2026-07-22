import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'

type JsonRecord = Record<string, unknown>

async function readJson(response: APIResponse): Promise<JsonRecord> {
  return ((await readJsonSafe<JsonRecord>(response)) ?? {}) as JsonRecord
}

async function listItems(request: APIRequestContext, token: string, query: string): Promise<JsonRecord[]> {
  const response = await apiRequest(request, 'GET', `/api/integrations?${query}`, { token })
  expect(response.status(), `GET /api/integrations?${query} should return 200`).toBe(200)
  const body = await readJson(response)
  return Array.isArray(body.items) ? (body.items as JsonRecord[]) : []
}

/**
 * TC-INT-009: List endpoint advanced filtering — isEnabled + healthStatus [P1]
 *
 * Surface: GET /api/integrations (requires integrations.view)
 *
 * isEnabled and healthStatus filters compose with AND semantics. Counts depend on
 * the registered providers and per-org state, so the assertions check that every
 * returned row satisfies the active filter(s) rather than asserting exact counts.
 */
test.describe('TC-INT-009: Integration list advanced filtering', () => {
  test('isEnabled and healthStatus filters return only matching rows', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    for (const enabled of [true, false]) {
      const items = await listItems(request, token, `isEnabled=${enabled}`)
      for (const item of items) {
        expect(item.isEnabled, `isEnabled=${enabled} must only return matching rows`).toBe(enabled)
      }
    }

    for (const status of ['healthy', 'degraded', 'unhealthy', 'unconfigured']) {
      const items = await listItems(request, token, `healthStatus=${status}`)
      for (const item of items) {
        expect(item.healthStatus, `healthStatus=${status} must only return matching rows`).toBe(status)
      }
    }
  })

  test('combined filters apply AND semantics', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const combined = await listItems(request, token, 'isEnabled=true&healthStatus=unconfigured')
    for (const item of combined) {
      expect(item.isEnabled).toBe(true)
      expect(item.healthStatus).toBe('unconfigured')
    }

    // The AND result can never exceed either single-filter result set.
    const enabledOnly = await listItems(request, token, 'isEnabled=true')
    const unconfiguredOnly = await listItems(request, token, 'healthStatus=unconfigured')
    expect(combined.length).toBeLessThanOrEqual(enabledOnly.length)
    expect(combined.length).toBeLessThanOrEqual(unconfiguredOnly.length)

    // A combination with no matches resolves to an empty array, never an error.
    const emptyCombo = await apiRequest(request, 'GET', '/api/integrations?isEnabled=false&healthStatus=healthy', { token })
    expect(emptyCombo.status()).toBe(200)
    expect(Array.isArray((await readJson(emptyCombo)).items)).toBe(true)
  })

  test('rejects an invalid boolean filter value with 400', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'GET', '/api/integrations?isEnabled=notabool', { token })
    expect(response.status(), 'an unparseable isEnabled value should be rejected').toBe(400)
  })
})
