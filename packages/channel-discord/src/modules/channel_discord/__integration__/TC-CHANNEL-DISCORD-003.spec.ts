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
 * TC-CHANNEL-DISCORD-003 — the hub's inbound landing zone accepts a
 * discord-tagged message.
 * Source: .ai/specs/2026-06-19-discord-communication-channel-integration.md
 *
 * ⚠️ SCOPE CORRECTION (QA of #4391, @Kapsik89 2026-08-04 → #4975).
 *
 * This spec previously claimed to prove that "an inbound Discord message lands
 * in the hub". It did not, and could not: the generic test-seed fixture is
 * email-shaped, so the earlier version invented a `@test-seed.local` address for
 * both `externalIdentifier` and `to` in order to satisfy the hub's
 * `externalEmail is required when visibility is public` rule. A real Discord
 * channel has `external_identifier = NULL` and a real Discord sender has no
 * address at all, so `normalizeInboundDiscordMessage` never ran on this path and
 * the spec stayed green while every real inbound message was rejected.
 *
 * What this spec asserts now is only what it can honestly assert: the hub
 * persists and counts an inbound message tagged `providerKey: 'discord'`. The
 * seeded address is named for what it is — fixture scaffolding required by the
 * hub contract under review — rather than dressed up as Discord data.
 *
 * The two halves it does NOT cover, and where they live instead:
 *  - Sender identity as Discord actually produces it (snowflake, no address):
 *    `lib/__tests__/normalize-inbound.identity.test.ts`.
 *  - The end-to-end path from a `MESSAGE_CREATE` frame to a persisted
 *    `ExternalMessage`: blocked by #4975 and covered by the `test.fixme` below,
 *    which must be turned into a real assertion in the same change that resolves
 *    the hub contract decision.
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
  test.fixme(
    'a message shaped the way the Discord gateway actually produces it is ingested',
    async () => {
      // Cannot be written until #4975 is decided. The gateway produces a sender
      // identified by a Discord snowflake and no address; the hub's
      // `composeMessageSchema` requires `externalEmail` (a real
      // `z.string().email()`) for every non-draft message with
      // `visibility: 'public'`, which is every message from an external sender.
      // Verified live during QA: the queued payload is complete and correct, and
      // the ingest command fails validation three times before the job dies.
      //
      // Turn this into a real assertion — driving the gateway payload through
      // `normalizeInboundDiscordMessage` with no invented address — in the same
      // change that resolves #4975, and delete this fixme. Do not "fix" it by
      // synthesising an address; #4975 rejects that explicitly.
    },
  )

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
      // Fixture scaffolding, not Discord data: the hub derives a channel's
      // `externalIdentifier` from email-shaped credential keys, so a real
      // Discord channel row carries NULL here (#4977). The address below exists
      // only to satisfy the seeder's own uniqueness handling.
      const fixtureAddress = `fixture-003-${stamp}@test-seed.local`
      channelId = await seedConnectedChannel(request, token, {
        displayName: `TC-CHANNEL-DISCORD-003 ${stamp}`,
        externalIdentifier: fixtureAddress,
      })

      const before = await readHealth(request, token, channelId)
      const deliveredBefore = before.counts?.delivered ?? 0
      const totalBefore = before.totalsLast24h ?? 0

      const seeded = await seedInboundMessage(request, token, {
        channelId,
        providerKey: 'discord',
        from: `discord-user-${stamp}`,
        // `to` and `subject` are hub-contract requirements, NOT things Discord
        // supplies — a Discord message has neither. They are the reason the real
        // path fails (#4975 / #4976) and are passed here purely to reach the
        // landing-zone assertions below.
        to: [fixtureAddress],
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
