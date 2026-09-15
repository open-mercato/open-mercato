import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  deleteChannelIfExists,
  ingestInboundChatMessage,
  isChannelSeedingAvailable,
  seedConnectedChannel,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'

/**
 * TC-CHANNEL-IDENTITY-001 — a provider whose senders have no email address
 * completes an inbound compose end to end.
 * Source: https://github.com/open-mercato/open-mercato/issues/4975
 *
 * This is the acceptance criterion for Variant A of the hub sender-identity
 * contract (`.ai/specs/2026-06-19-discord-communication-channel-integration.md`
 * § Open decision — hub sender-identity contract).
 *
 * It is deliberately written to be un-fakeable in the way its predecessor was.
 * `TC-CHANNEL-DISCORD-003` on #4391 stayed green through three live defects
 * because it invented a `…@test-seed.local` address for both the channel
 * identifier and the recipient, satisfying a hub rule the real provider could
 * never satisfy, and because the seed endpoint it drove inserted the platform
 * message with raw SQL — so `composeMessageSchema` never ran on that path.
 *
 * Here:
 *   - the channel is connected through the non-email stub, so it carries a
 *     non-email `channelType` and a NULL `externalIdentifier`, exactly like a
 *     real Discord channel;
 *   - the sender is an opaque handle and the fixture offers no way to pass an
 *     address at all;
 *   - the message travels the real `ingest_inbound_message` command, which
 *     composes through `messages.messages.compose`. Before #4975 this step
 *     failed with `externalEmail is required when visibility is public`.
 *
 * Driven via the env-gated test-seed fixture (`OM_ENABLE_TEST_CHANNEL_SEEDING`);
 * skips when the gate is off.
 */
test.describe('TC-CHANNEL-IDENTITY-001: inbound compose without a sender email address', () => {
  test('ingests a message from a sender identified only by an opaque handle', async ({
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
        'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled in this environment; cannot connect a channel.',
      )

      const stamp = Date.now()
      channelId = await seedConnectedChannel(request, token, {
        displayName: `TC-CHANNEL-IDENTITY-001 ${stamp}`,
        providerFlavor: 'chat',
      })

      const channelResponse = await apiRequest(
        request,
        'GET',
        `/api/communication_channels/channels/${channelId}`,
        { token },
      )
      expect(channelResponse.status(), 'GET channel detail should return 200').toBe(200)
      const channel = await readJsonSafe<Record<string, unknown>>(channelResponse)
      expect(
        channel?.channelType,
        'the fixture must connect a genuinely non-email channel, or this test proves nothing',
      ).not.toBe('email')

      // The sender as the provider actually produces one: an opaque handle, no
      // address anywhere in the payload.
      const senderIdentifier = `chat-user-${stamp}`
      const ingested = await ingestInboundChatMessage(request, token, {
        channelId,
        senderIdentifier,
        senderDisplayName: 'Karol Kapsa',
        body: 'hello from a guild channel',
        externalMessageId: `chat-message-${stamp}`,
        externalConversationId: `chat-conversation-${stamp}`,
      })

      expect(
        ingested.status,
        'the hub must accept an inbound message from a sender with no email address',
      ).toBe('created')
      expect(ingested.messageId, 'a platform message must have been composed').toBeTruthy()
      expect(ingested.channelLinkId, 'the message must be linked back to the channel').toBeTruthy()
      expect(ingested.conversationId, 'an external conversation must exist').toBeTruthy()

      // The channel's own health view is the operator-visible signal that the
      // message landed. (The composed message itself is participant-scoped: its
      // author is the module's system user and it has no recipient, so an admin
      // is not authorized to read it through `GET /api/messages/[id]`.)
      //
      // Asserted on the window total, not on `counts.delivered`: a real inbound
      // link is written with `deliveryStatus: 'received'`, which the health route
      // does not have a bucket for and folds into `counts.other`. The predecessor
      // test asserted `counts.delivered` and passed only because the seeding
      // shortcut it drove wrote `'delivered'` by hand — one more way that fixture
      // described a message the ingest path never produces.
      const healthResponse = await apiRequest(
        request,
        'GET',
        `/api/communication_channels/channels/${channelId}/health`,
        { token },
      )
      expect(healthResponse.status(), 'GET /channels/[id]/health should return 200').toBe(200)
      const health = await readJsonSafe<{
        counts?: Record<string, number>
        totalsLast24h?: number
      }>(healthResponse)
      expect(
        health?.totalsLast24h ?? 0,
        'the ingested message must be counted against the channel',
      ).toBe(1)

      // That the hub invents no address for such a sender — option C, rejected
      // by #4975 — is pinned by unit tests over the compose payload:
      // `communication_channels/commands/__tests__/ingest-inbound-message.test.ts`
      // and `messages/data/__tests__/validators.test.ts`.

      // Re-delivery of the same frame is still idempotent under the new contract.
      const replay = await ingestInboundChatMessage(request, token, {
        channelId,
        senderIdentifier,
        senderDisplayName: 'Karol Kapsa',
        body: 'hello from a guild channel',
        externalMessageId: `chat-message-${stamp}`,
        externalConversationId: `chat-conversation-${stamp}`,
      })
      expect(replay.status, 'a replayed frame must dedup rather than compose again').toBe(
        'duplicate',
      )
    } finally {
      await deleteChannelIfExists(request, token, channelId)
    }
  })
})
