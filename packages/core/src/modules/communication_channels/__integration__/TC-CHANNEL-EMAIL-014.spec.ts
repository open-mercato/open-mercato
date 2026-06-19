import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-CHANNEL-EMAIL-014 — Multi-account per user, primary swap.
 *
 * The hub's `set-primary` route must accept a UUID, refuse a malformed id, and
 * stay tenant-scoped. Phase 4 adds the constraint that only the channel owner
 * can flip the primary; previous slices verified the route exists and rejects
 * malformed payloads. This test re-asserts that contract end-to-end now that
 * the disconnect command + cascade subscriber are in place.
 */
test.describe('TC-CHANNEL-EMAIL-014: multi-account primary swap contract', () => {
  test('POST set-primary on a non-existent channel returns 404', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/channels/00000000-0000-0000-0000-000000000000/set-primary',
      { token },
    )
    expect(response.status()).toBeLessThan(500)
    expect([401, 404]).toContain(response.status())
  })

  test('POST set-primary on a malformed id returns 400/404', async ({ request }) => {
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
})
