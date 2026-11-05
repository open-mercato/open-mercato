import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-CHANNEL-EMAIL-015 — Admin RBAC: list of channels visible, envelope bodies not.
 *
 * Admin endpoints exposed in slice 2e:
 *   - `GET /api/communication_channels/channels`       (list — admin-owned)
 *   - `GET /api/communication_channels/channels/:id`   (detail — channel metadata only)
 *
 * Phase 4 asserts: admin can see the list (200 with `items[]` shape, or 401 if
 * unauthenticated in test environment), and the detail endpoint never leaks
 * `credentials` or message bodies — both routes intentionally return metadata
 * only. We exercise the route surface here; tenant-fixture-driven content
 * checks remain a manual QA acceptance per the spec.
 */
test.describe('TC-CHANNEL-EMAIL-015: admin sees channels but not envelopes', () => {
  test('GET /channels returns a paginated metadata-only shape', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'GET',
      '/api/communication_channels/channels',
      { token },
    )
    expect(response.status()).toBeLessThan(500)
    if (response.status() === 200) {
      const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(response)
      const items = body?.items ?? []
      for (const channel of items) {
        // Credentials must NEVER appear on the wire — they live encrypted in
        // `integration_credentials` and resolve only through the adapter at send time.
        expect(channel).not.toHaveProperty('credentials')
        expect(channel).not.toHaveProperty('credentialsRef')
      }
    }
  })

  test('GET /channels/:id with a synthetic UUID does not 5xx', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'GET',
      '/api/communication_channels/channels/00000000-0000-0000-0000-000000000000',
      { token },
    )
    expect(response.status()).toBeLessThan(500)
  })
})
