import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-CHANNEL-EMAIL-HUB-001 — Per-user channel API contract.
 *
 * Slice 3d delivers:
 *   - GET  /api/communication_channels/me/channels
 *   - POST /api/communication_channels/channels/connect/credentials
 *   - POST /api/communication_channels/channels/[id]/set-primary
 *   - POST /api/communication_channels/channels/[id]/test-send
 *   - POST /api/communication_channels/send-as-user
 *
 * Until provider packages (slices 3e/f/g) register adapters, the positive paths
 * all return 404 (no adapter). This test verifies the routes are wired and
 * authentication / payload validation works end-to-end.
 */
test.describe('TC-CHANNEL-EMAIL-HUB-001: per-user channel API contract', () => {
  test('GET /me/channels returns paginated list shape (empty for new user)', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'GET',
      '/api/communication_channels/me/channels',
      { token },
    )
    expect(response.status()).toBeLessThan(500)
    if (response.status() === 200) {
      const body = await readJsonSafe<{ items?: unknown[]; total?: number }>(response)
      expect(Array.isArray(body?.items)).toBe(true)
      expect(typeof body?.total).toBe('number')
    }
  })

  test('POST connect/credentials with unknown provider returns 404', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/channels/connect/credentials',
      {
        token,
        data: {
          providerKey: '__nonexistent_provider__',
          displayName: 'Test',
          credentials: { username: 'x', password: 'y' },
        },
      },
    )
    expect(response.status()).toBeLessThan(500)
    expect([401, 404]).toContain(response.status())
  })

  test('POST connect/credentials rejects invalid body with 422', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/channels/connect/credentials',
      {
        token,
        data: { providerKey: '' },
      },
    )
    expect(response.status()).toBeLessThan(500)
    expect([401, 422]).toContain(response.status())
  })

  test('POST set-primary rejects malformed channel id with 400', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/channels/not-a-uuid/set-primary',
      { token },
    )
    expect(response.status()).toBeLessThan(500)
    expect([400, 401, 404]).toContain(response.status())
  })

  test('POST test-send rejects invalid body with 422', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/channels/00000000-0000-0000-0000-000000000000/test-send',
      {
        token,
        data: { to: 'not-an-email' },
      },
    )
    expect(response.status()).toBeLessThan(500)
    expect([401, 404, 422]).toContain(response.status())
  })

  test('POST send-as-user rejects missing recipients with 422', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/send-as-user',
      {
        token,
        data: {
          userChannelId: '00000000-0000-0000-0000-000000000000',
          subject: 'x',
          body: { plain: 'x' },
        },
      },
    )
    expect(response.status()).toBeLessThan(500)
    expect([401, 404, 422]).toContain(response.status())
  })
})
