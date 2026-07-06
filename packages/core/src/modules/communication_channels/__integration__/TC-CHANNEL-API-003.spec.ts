import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  deleteChannelIfExists,
  isChannelSeedingAvailable,
  seedConnectedChannel,
  seedInboundMessage,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'

/**
 * TC-CHANNEL-API-003 — GET /channels/[id]/health returns delivery metrics.
 * Source: https://github.com/open-mercato/open-mercato/issues/2486
 *
 * Health aggregates `message_channel_links` for the channel over the trailing
 * 24h window. We seed one inbound message (lands as a 'delivered' link), then
 * assert the snapshot is scoped to the channel and reports numeric counts.
 *
 * Driven via the env-gated test-seed fixture (`OM_ENABLE_TEST_CHANNEL_SEEDING`);
 * skips when the gate is off.
 */
test.describe('TC-CHANNEL-API-003: channel health metrics', () => {
  test('reports numeric delivery counts and includes a seeded message', async ({ request }) => {
    test.slow()
    let token: string | null = null
    let channelId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const seedingAvailable = await isChannelSeedingAvailable(request, token)
      test.skip(
        !seedingAvailable,
        'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled in this environment; cannot seed a channel/message.',
      )

      const stamp = Date.now()
      channelId = await seedConnectedChannel(request, token, {
        displayName: `TC-CHANNEL-API-003 ${stamp}`,
        externalIdentifier: `api-003-${stamp}@test-seed.local`,
      })
      await seedInboundMessage(request, token, {
        channelId,
        from: `sender-${stamp}@example.com`,
        to: [`api-003-${stamp}@test-seed.local`],
        subject: `Health seed ${stamp}`,
        bodyText: 'seed message for the health window',
      })

      const response = await apiRequest(
        request,
        'GET',
        `/api/communication_channels/channels/${channelId}/health`,
        { token },
      )
      expect(response.status(), 'GET health should return 200').toBe(200)

      const body = await readJsonSafe<{
        channelId?: string
        counts?: Record<string, number>
        totalsLast24h?: number
      }>(response)
      expect(body?.channelId, 'health is scoped to the requested channel').toBe(channelId)

      const counts = body?.counts ?? {}
      expect(typeof counts.sent, 'counts.sent is numeric').toBe('number')
      expect(typeof counts.failed, 'counts.failed is numeric').toBe('number')
      expect(counts.sent, 'counts.sent >= 0').toBeGreaterThanOrEqual(0)
      expect(counts.failed, 'counts.failed >= 0').toBeGreaterThanOrEqual(0)
      // The seeded inbound link lands inside the trailing-24h window.
      expect(body?.totalsLast24h ?? 0, 'the seeded message is counted in the 24h window').toBeGreaterThanOrEqual(1)
    } finally {
      await deleteChannelIfExists(request, token, channelId)
    }
  })
})
