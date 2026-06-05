import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  deleteChannelIfExists,
  isChannelSeedingAvailable,
  seedConnectedChannel,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'

/**
 * TC-CHANNEL-API-007 — DELETE /channels/[id] soft-deletes the channel.
 * Source: https://github.com/open-mercato/open-mercato/issues/2486
 *
 * Deleting a seeded channel returns 204, and the soft-deleted row is no longer
 * retrievable: a subsequent GET returns 404.
 *
 * Driven via the env-gated test-seed fixture (`OM_ENABLE_TEST_CHANNEL_SEEDING`);
 * skips when the gate is off.
 */
test.describe('TC-CHANNEL-API-007: DELETE soft-deletes a channel', () => {
  test('DELETE returns 204 and a subsequent GET returns 404', async ({ request }) => {
    let token: string | null = null
    let channelId: string | null = null
    let deleted = false
    try {
      token = await getAuthToken(request, 'admin')
      const seedingAvailable = await isChannelSeedingAvailable(request, token)
      test.skip(
        !seedingAvailable,
        'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled in this environment; cannot seed a connected channel.',
      )

      channelId = await seedConnectedChannel(request, token, {
        displayName: `TC-CHANNEL-API-007 ${Date.now()}`,
      })

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/communication_channels/channels/${channelId}`,
        { token },
      )
      expect(deleteResponse.status(), 'DELETE should return 204').toBe(204)
      deleted = true

      const getResponse = await apiRequest(
        request,
        'GET',
        `/api/communication_channels/channels/${channelId}`,
        { token },
      )
      expect(getResponse.status(), 'a soft-deleted channel is no longer retrievable (404)').toBe(404)
    } finally {
      // Already deleted in the happy path; deleteChannelIfExists is best-effort.
      if (!deleted) await deleteChannelIfExists(request, token, channelId)
    }
  })
})
