import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-CHANNEL-API-012 — GET /me/channels reports automatic sync for a scheduler-enabled app.
 *
 * Regression for https://github.com/open-mercato/open-mercato/issues/8804: the profile
 * page reads `automaticSyncEnabled` to warn when no scheduled job polls the user's
 * mailboxes. The integration app enables `scheduler`, and tenant initialization seeds
 * the organization's poll tick, so the real request container must report `true`.
 * Read-only — creates no fixtures, so there is nothing to clean up.
 */
test.describe('TC-CHANNEL-API-012: me/channels reports automatic sync', () => {
  test('reports automaticSyncEnabled when the scheduler polls the organization', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const response = await apiRequest(request, 'GET', '/api/communication_channels/me/channels', { token })
    expect(response.status(), 'GET /me/channels should return 200').toBe(200)

    const body = await readJsonSafe<{ items?: unknown[]; automaticSyncEnabled?: boolean }>(response)
    expect(Array.isArray(body?.items)).toBe(true)
    expect(body?.automaticSyncEnabled).toBe(true)
  })
})
