import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  deleteChannelIfExists,
  isChannelSeedingAvailable,
  seedConnectedChannel,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'

/**
 * TC-CHANNEL-API-004 — POST /channels/[id]/poll-now enqueues a poll.
 * Source: https://github.com/open-mercato/open-mercato/issues/2486
 *
 * A connected channel accepts a manual poll: the route enqueues a poll-channel
 * job and returns 202 Accepted. `lastPolledAt` is updated asynchronously by the
 * worker (not in the response), so we assert the queued acknowledgement instead.
 *
 * Driven via the env-gated test-seed fixture (`OM_ENABLE_TEST_CHANNEL_SEEDING`);
 * skips when the gate is off.
 */
test.describe('TC-CHANNEL-API-004: poll-now enqueues a poll', () => {
  test('accepts a manual poll for a connected channel (202)', async ({ request }) => {
    let token: string | null = null
    let channelId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const seedingAvailable = await isChannelSeedingAvailable(request, token)
      test.skip(
        !seedingAvailable,
        'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled in this environment; cannot seed a connected channel.',
      )

      channelId = await seedConnectedChannel(request, token, {
        displayName: `TC-CHANNEL-API-004 ${Date.now()}`,
      })

      const response = await apiRequest(
        request,
        'POST',
        `/api/communication_channels/channels/${channelId}/poll-now`,
        { token },
      )
      expect(response.status(), 'poll-now should enqueue and return 202').toBe(202)

      const body = await readJsonSafe<{ ok?: boolean; queued?: boolean; channelId?: string }>(response)
      expect(body?.ok, 'poll-now acknowledges the request').toBe(true)
      expect(body?.queued, 'a poll job is queued').toBe(true)
      expect(body?.channelId, 'poll-now echoes the channel id').toBe(channelId)
    } finally {
      await deleteChannelIfExists(request, token, channelId)
    }
  })
})
