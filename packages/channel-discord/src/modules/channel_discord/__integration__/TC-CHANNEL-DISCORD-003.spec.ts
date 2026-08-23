import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  deleteChannelIfExists,
  ingestInboundChatMessage,
  isChannelSeedingAvailable,
  seedConnectedChannel,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'
import { normalizeInboundDiscordMessage } from '../lib/normalize-inbound'

/**
 * TC-CHANNEL-DISCORD-003 — a message shaped the way the Discord gateway
 * actually produces it is ingested end to end.
 * Source: .ai/specs/2026-06-19-discord-communication-channel-integration.md
 *
 * ⚠️ HISTORY, because this spec earned the scepticism (QA of #4391, @Kapsik89
 * 2026-08-04 → #4975).
 *
 * The first version of this spec claimed to prove that "an inbound Discord
 * message lands in the hub" and stayed green through three live defects. It fed
 * the hub an invented `…@test-seed.local` address for both the channel
 * identifier and the recipient, because the hub's `composeMessageSchema`
 * demanded `externalEmail` for every public message. A real Discord channel
 * carries `external_identifier = NULL` and a real Discord sender has no address
 * at all, so `normalizeInboundDiscordMessage` never ran on that path — the spec
 * asserted a landing zone the real provider could never reach.
 *
 * Both halves of that are fixed now:
 *   - #4975 (merged as #5252) made the `externalEmail` requirement conditional
 *     on the originating channel being email-typed, fail-closed.
 *   - the test-seed `ingest-inbound` action drives the real
 *     `ingest_inbound_message` command, which composes through
 *     `messages.messages.compose` — no SQL shortcut, no seeded rows.
 *
 * So this spec now does what its name always claimed:
 *   1. it starts from a verbatim Discord `MESSAGE_CREATE` frame,
 *   2. runs it through the **real** `normalizeInboundDiscordMessage` — the same
 *      function the gateway worker calls, not a re-implementation,
 *   3. hands the normalized result to the hub with **no address anywhere**, and
 *   4. asserts a platform message exists at the other end.
 *
 * Ceiling, stated rather than implied: the transport is the chat-flavoured
 * test-seed adapter, because connecting a real Discord channel requires a live
 * bot token and a live credential probe, neither of which exists in CI. What is
 * NOT stubbed is the part that was broken — the Discord frame, the Discord
 * normalizer, and the hub's compose validation. The socket state machine
 * (identify/resume/backoff, bot-self filtering, replay dedup) is a pure state
 * machine covered by `lib/__tests__/discord-gateway-client.test.ts` and
 * `lib/__tests__/gateway-bridge.test.ts`.
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

/**
 * A `MESSAGE_CREATE` frame in the exact shape Discord delivers it. The values
 * are the ones QA captured from a real guild while filing #4975 — in particular
 * the author id is a genuine snowflake, which is the whole point: there is no
 * address on it, and none is invented anywhere below.
 */
function discordMessageCreateFrame(stamp: number) {
  return {
    id: `1534333813851816${String(stamp).slice(-3)}`,
    channel_id: '1534331920463433771',
    guild_id: '1534331919796273152',
    content: 'Kolejna wiadomość testowa!@',
    timestamp: new Date().toISOString(),
    author: {
      id: '1499156851487539260',
      username: 'lorakaspak',
      global_name: 'Karol Kapsa',
      bot: false,
    },
    attachments: [],
  }
}

test.describe('TC-CHANNEL-DISCORD-003: inbound discord message ingest', () => {
  test('a message shaped the way the Discord gateway actually produces it is ingested', async ({
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
        'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled in this environment; cannot ingest.',
      )

      const stamp = Date.now()
      // `providerFlavor: 'chat'` connects the non-email stub, so the channel row
      // carries a non-email `channelType` and a NULL `externalIdentifier` — the
      // shape a real Discord channel has. No `externalIdentifier` is passed.
      channelId = await seedConnectedChannel(request, token, {
        displayName: `TC-CHANNEL-DISCORD-003 ${stamp}`,
        providerFlavor: 'chat',
      })

      const before = await readHealth(request, token, channelId)
      const totalBefore = before.totalsLast24h ?? 0

      // The real normalizer, on a real frame. If Discord's payload shape and the
      // hub's expectations ever drift apart, this line is where it shows.
      const frame = discordMessageCreateFrame(stamp)
      const normalized = normalizeInboundDiscordMessage(frame as never)

      expect(
        normalized.senderIdentifier,
        'the sender must stay the Discord snowflake — synthesising an address here is what #4975 rejects',
      ).toBe('1499156851487539260')
      expect(normalized.externalConversationId).toBe('discord-channel:1534331920463433771')
      expect(
        (normalized as { externalEmail?: unknown }).externalEmail,
        'the normalizer must not invent an address',
      ).toBeUndefined()

      const ingested = await ingestInboundChatMessage(request, token, {
        channelId,
        senderIdentifier: normalized.senderIdentifier,
        senderDisplayName: normalized.senderDisplayName,
        body: normalized.body,
        externalMessageId: normalized.externalMessageId,
        externalConversationId: normalized.externalConversationId,
      })

      // The assertion the old version could not make: the hub composed a real
      // platform message from a sender with no address. Before #4975 this step
      // failed `externalEmail is required when visibility is public`, retried
      // three times and died in the queue while the channel still read
      // `Connected`.
      expect(
        ingested.status,
        'the hub must accept an inbound message whose sender has no email address',
      ).toBe('created')
      expect(ingested.messageId, 'a platform message must exist').toBeTruthy()
      expect(ingested.channelLinkId, 'the hub must persist a MessageChannelLink').toBeTruthy()
      expect(
        ingested.channelType,
        'the compose must have been told the originating channel type',
      ).not.toBe('email')

      const after = await readHealth(request, token, channelId)
      expect(
        after.totalsLast24h ?? 0,
        'the channel health snapshot must count the ingested message',
      ).toBeGreaterThan(totalBefore)
    } finally {
      if (token && channelId) await deleteChannelIfExists(request, token, channelId)
    }
  })
})
