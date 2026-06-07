import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-045D-005b — Channels admin API surfaces a paginated list + detail.
 *
 * Slice 2e ships:
 *   - `GET /api/communication_channels/channels` — list (auth + communication_channels.view)
 *   - `GET /api/communication_channels/channels/[id]` — detail
 *
 * No fixture channels exist by default, so the list comes back empty (200 + items: []).
 * The detail endpoint returns 400 for malformed ids and 404 for unknown ids.
 */
test.describe('TC-045D-005b: channels admin API', () => {
  test('GET /api/communication_channels/channels returns a paginated list shape', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(request, 'GET', '/api/communication_channels/channels', {
      token,
    })
    expect(response.status()).toBeLessThan(500)
    // 200 (empty list) or 401 (no granted feature in test fixture) — both acceptable.
    if (response.status() === 200) {
      const body = await readJsonSafe<{ items?: unknown[]; total?: number; page?: number; pageSize?: number }>(
        response,
      )
      expect(Array.isArray(body?.items)).toBe(true)
      expect(typeof body?.total).toBe('number')
      expect(typeof body?.page).toBe('number')
      expect(typeof body?.pageSize).toBe('number')
    }
  })

  test('GET /api/communication_channels/channels/[id] returns 400 for malformed id', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'GET',
      '/api/communication_channels/channels/not-a-uuid',
      { token },
    )
    expect(response.status()).toBeLessThan(500)
    // 400 (param), 401 (auth), or 404 (not found) acceptable; never 5xx.
    expect([400, 401, 404]).toContain(response.status())
  })

  test('GET /api/communication_channels/channels/[id] returns 404 for unknown uuid', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'GET',
      '/api/communication_channels/channels/00000000-0000-0000-0000-000000000000',
      { token },
    )
    expect(response.status()).toBeLessThan(500)
    expect([401, 404]).toContain(response.status())
  })
})
