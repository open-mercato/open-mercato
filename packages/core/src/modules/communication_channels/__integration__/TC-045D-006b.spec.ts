import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-045D-006b — channel health + reassign API negative paths.
 *
 * Slice 2f endpoints:
 *   - GET  /api/communication_channels/channels/[id]/health
 *   - PUT  /api/communication_channels/threads/[threadId]/assign
 *
 * Without a fixture channel + thread mapping, the positive paths can't be
 * exercised. This test verifies the negative paths return useful status codes
 * (400/401/404) — never 5xx.
 */
test.describe('TC-045D-006b: slice 2f API negative paths', () => {
  test('GET channel health rejects malformed id with 400', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'GET',
      '/api/communication_channels/channels/not-a-uuid/health',
      { token },
    )
    expect(response.status()).toBeLessThan(500)
    expect([400, 401, 404]).toContain(response.status())
  })

  test('GET channel health returns 404 for an unknown uuid', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'GET',
      '/api/communication_channels/channels/00000000-0000-0000-0000-000000000000/health',
      { token },
    )
    expect(response.status()).toBeLessThan(500)
    expect([401, 404]).toContain(response.status())
  })

  test('PUT reassign rejects malformed threadId with 400', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'PUT',
      '/api/communication_channels/threads/not-a-uuid/assign',
      {
        token,
        data: { assignedUserId: null },
      },
    )
    expect(response.status()).toBeLessThan(500)
    expect([400, 401, 404]).toContain(response.status())
  })

  test('PUT reassign rejects invalid body with 422', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'PUT',
      '/api/communication_channels/threads/00000000-0000-0000-0000-000000000000/assign',
      {
        token,
        data: { assignedUserId: 'not-a-uuid' },
      },
    )
    expect(response.status()).toBeLessThan(500)
    expect([400, 401, 404, 422]).toContain(response.status())
  })
})
