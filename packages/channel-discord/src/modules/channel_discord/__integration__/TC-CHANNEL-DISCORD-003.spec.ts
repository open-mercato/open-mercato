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
 * TC-CHANNEL-DISCORD-003 — an inbound Discord message lands in the hub.
 * Source: .ai/specs/2026-06-19-discord-communication-channel-integration.md
 *
 * The gateway worker's whole job is to turn a `MESSAGE_CREATE` frame into the
 * hub's existing `ingest_inbound` payload — it adds no Discord-specific storage.
 * This spec drives that landing zone with `providerKey: 'discord'` against real
 * Postgres and asserts the hub persists it as a delivered inbound link that the
 * channel's health window counts.
 *
 * The socket half (identify/resume/backoff, bot-self filtering, replay dedup by
 * external message id) is a pure state machine and is unit-tested in
 * `lib/__tests__/discord-gateway-client.test.ts` and
 * `lib/__tests__/gateway-bridge.test.ts` — it needs no running app.
 *
 * Driven via the env-gated test-seed fixture (`OM_ENABLE_TEST_CHANNEL_SEEDING`);
 * skips when the gate is off.
 */
type HealthSnapshot = {
  channelId?: string
  counts?: Record<string, number>
  totalsLast24h?: number
}

async function readHealth(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  channelId: string,
): Promise<HealthSnapshot> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/communication_channels/channels/${channelId}/health`,
    { token },
  )
  expect(response.status(), 'GET /channels/[id]/health should return 200').toBe(200)
  return (await readJsonSafe<HealthSnapshot>(response)) ?? {}
}

test.describe('TC-CHANNEL-DISCORD-003: inbound discord message ingest', () => {
  test('a discord-provider inbound message is persisted as a delivered inbound link', async ({
    request,
  }) => {
    test.slow()
    let token: string | null = null
    let channelId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const seedingAvailable = await isChannelSeedingAvailable(request, token)
      test.skip(
        !seedingAvailable,
        'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled in this environment; cannot emit inbound messages.',
      )

      const stamp = Date.now()
      channelId = await seedConnectedChannel(request, token, {
        displayName: `TC-CHANNEL-DISCORD-003 ${stamp}`,
        externalIdentifier: `discord-003-${stamp}@test-seed.local`,
      })

      const before = await readHealth(request, token, channelId)
      const deliveredBefore = before.counts?.delivered ?? 0
      const totalBefore = before.totalsLast24h ?? 0

      const seeded = await seedInboundMessage(request, token, {
        channelId,
        providerKey: 'discord',
        from: `discord-user-${stamp}`,
        to: [`discord-003-${stamp}@test-seed.local`],
        subject: `Discord inbound ${stamp}`,
        bodyText: 'hello from a discord guild channel',
        messageId: `discord-message-${stamp}`,
      })
      expect(seeded.channelLinkId, 'the hub must persist a MessageChannelLink').toBeTruthy()
      expect(seeded.conversationId, 'the hub must persist an ExternalConversation').toBeTruthy()

      const after = await readHealth(request, token, channelId)
      expect(after.channelId, 'health must be scoped to the channel under test').toBe(channelId)
      expect(
        after.counts?.delivered ?? 0,
        'the discord inbound message must be counted as delivered',
      ).toBe(deliveredBefore + 1)
      expect(
        after.totalsLast24h ?? 0,
        'the discord inbound message must appear in the 24h window total',
      ).toBe(totalBefore + 1)
    } finally {
      await deleteChannelIfExists(request, token, channelId)
    }
  })
})
