import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'

type JsonRecord = Record<string, unknown>

// A fixed, well-formed UUID that no seeded log will reference.
const NON_MATCHING_UUID = '00000000-0000-4000-8000-000000000000'

async function readJson(response: APIResponse): Promise<JsonRecord> {
  return ((await readJsonSafe<JsonRecord>(response)) ?? {}) as JsonRecord
}

async function pickIntegrationId(request: APIRequestContext, token: string): Promise<string> {
  const listBody = await readJson(await apiRequest(request, 'GET', '/api/integrations', { token }))
  const items = Array.isArray(listBody.items) ? (listBody.items as JsonRecord[]) : []
  return items.length > 0 ? String(items[0].id) : 'nonexistent_integration'
}

/**
 * TC-INT-007: Integration logs filtering by entity scope and runId [P1]
 *
 * Surface: GET /api/integrations/logs (requires integrations.manage)
 *
 * The validation and empty-result behaviours are deterministic and need no
 * seeded data. The list/logs read routes validate their query with a 400 (the
 * mutation routes use 422 for body validation), so invalid runId/entityId UUIDs
 * are rejected with 400. AND-filter correctness over real rows is asserted only
 * when the environment already has logs (none are written without integration
 * activity).
 */
test.describe('TC-INT-007: Integration logs filtering', () => {
  test('rejects invalid UUID filters with 400', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const badRunId = await apiRequest(request, 'GET', '/api/integrations/logs?runId=not-a-uuid', { token })
    expect(badRunId.status(), 'a non-UUID runId should be rejected by query validation').toBe(400)

    const badEntityId = await apiRequest(request, 'GET', '/api/integrations/logs?entityId=not-a-uuid', { token })
    expect(badEntityId.status(), 'a non-UUID entityId should be rejected by query validation').toBe(400)
  })

  test('returns an empty list (not 404) for non-matching filters', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const response = await apiRequest(
      request,
      'GET',
      `/api/integrations/logs?entityId=${NON_MATCHING_UUID}&runId=${NON_MATCHING_UUID}`,
      { token },
    )
    expect(response.status(), 'a non-matching filter should still return 200').toBe(200)
    const body = await readJson(response)
    expect(Array.isArray(body.items)).toBe(true)
    expect((body.items as unknown[]).length).toBe(0)
    expect(body.total).toBe(0)
  })

  test('returns a paginated shape and scopes results to the integrationId filter', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const integrationId = await pickIntegrationId(request, token)

    const response = await apiRequest(
      request,
      'GET',
      `/api/integrations/logs?integrationId=${encodeURIComponent(integrationId)}&page=1&pageSize=25`,
      { token },
    )
    expect(response.status()).toBe(200)
    const body = await readJson(response)
    expect(Array.isArray(body.items)).toBe(true)
    expect(body.page).toBe(1)
    expect(body.pageSize).toBe(25)
    expect(typeof body.total).toBe('number')
    expect(typeof body.totalPages).toBe('number')
    for (const item of body.items as JsonRecord[]) {
      expect(item.integrationId, 'every item must satisfy the integrationId filter').toBe(integrationId)
    }
  })

  test('applies AND logic across filters when logs exist', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const allLogs = await readJson(await apiRequest(request, 'GET', '/api/integrations/logs?page=1&pageSize=50', { token }))
    const items = Array.isArray(allLogs.items) ? (allLogs.items as JsonRecord[]) : []
    if (items.length === 0) {
      test.skip(true, 'No integration logs present — skipping AND-filter assertions')
      return
    }

    const sample = items[0]
    const integrationId = String(sample.integrationId)

    // Filtering by the sample's integrationId returns only its rows.
    const scoped = await readJson(
      await apiRequest(
        request,
        'GET',
        `/api/integrations/logs?integrationId=${encodeURIComponent(integrationId)}&page=1&pageSize=50`,
        { token },
      ),
    )
    for (const item of scoped.items as JsonRecord[]) {
      expect(item.integrationId).toBe(integrationId)
    }

    // Combining the integrationId with a non-matching entityId excludes everything (AND, not OR).
    const intersected = await readJson(
      await apiRequest(
        request,
        'GET',
        `/api/integrations/logs?integrationId=${encodeURIComponent(integrationId)}&entityId=${NON_MATCHING_UUID}`,
        { token },
      ),
    )
    expect((intersected.items as unknown[]).length).toBe(0)
  })
})
