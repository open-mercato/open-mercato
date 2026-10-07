import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  deleteChannelIfExists,
  ingestInboundChatMessage,
  isChannelSeedingAvailable,
  seedConnectedChannel,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'
import { CHANNEL_DISCORD_AI_PROPOSAL_SOURCE_ENTITY_TYPE } from '../lib/ai-proposal-contract'
import {
  CHANNEL_DISCORD_AI_PROPOSAL_APPROVE_ACTION_ID,
  CHANNEL_DISCORD_AI_PROPOSAL_MESSAGE_TYPE,
} from '../message-types'

/**
 * TC-CHANNEL-DISCORD-012 — the AI auto-reply SEND path completes for a sender
 * who has no email address.
 * Source: https://github.com/open-mercato/open-mercato/issues/5601
 *
 * The auto-reply's two tiers compose the same public reply through the same hub
 * command: the `easy` tier sends it unattended, the `complex` tier files a
 * proposal a human approves and the approve command sends it. Both omitted
 * `sourceChannelType`, `channelTypeRequiresExternalEmail` fails closed on an
 * absent one, and so the hub demanded an `externalEmail` from a Discord sender —
 * a snowflake with no address. Every send threw `ZodError` and the subscriber
 * degraded to a no-op, which is why the feature shipped and never replied to
 * anyone.
 *
 * This spec drives the half of that path a test environment can reach without a
 * live model: an inbound message with no address anywhere, a proposal filed
 * against it, and a human approving the send. Everything after the approve is
 * production code — the approve command, `messages.messages.compose`, the
 * validator that rejected it, and the outbound bridge.
 *
 * Ceiling, stated rather than implied: the `easy` tier's unattended send starts
 * at an AI model call, which CI has no provider for. Its compose payload is
 * validated against the hub's REAL `composeMessageSchema` in
 * `subscribers/__tests__/ai-auto-reply.test.ts` and driven through the real
 * agent policy in `__tests__/ai-auto-reply.policy.integration.test.ts`; the two
 * tiers build the same payload, and this spec proves the hub accepts it over the
 * wire.
 *
 * Deliberately NOT stubbed: no address is invented anywhere. Inventing one is
 * exactly how the predecessor of TC-CHANNEL-DISCORD-003 stayed green through
 * three live defects (#4975).
 *
 * Driven via the env-gated test-seed fixture (`OM_ENABLE_TEST_CHANNEL_SEEDING`);
 * skips when the gate is off.
 */
test.describe('TC-CHANNEL-DISCORD-012: the AI reply send path', () => {
  test('sends an approved reply on a channel whose sender has no address', async ({ request }) => {
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
      const { userId } = getTokenScope(token)

      // `providerFlavor: 'chat'` connects the non-email stub: senders carry an
      // opaque handle, `external_identifier` is NULL, and the fixture offers no
      // way to pass an address — the shape a real Discord channel has.
      channelId = await seedConnectedChannel(request, token, {
        displayName: `TC-CHANNEL-DISCORD-012 ${stamp}`,
        providerFlavor: 'chat',
      })

      const inbound = await ingestInboundChatMessage(request, token, {
        channelId,
        senderIdentifier: '1499156851487539260',
        senderDisplayName: 'Karol Kapsa',
        body: 'cześć, czy mogę pisać do was po polsku?',
        externalMessageId: `tc-discord-012-${stamp}`,
        externalConversationId: `tc-discord-012-conv-${stamp}`,
      })
      expect(inbound.messageId, 'the inbound message must land before a reply can be proposed').toBeTruthy()

      // The proposal the `complex` tier files: an internal note addressed to a
      // reviewer, carrying the drafted reply as its body and pointing at the
      // inbound message it answers. Nothing here can reach Discord on its own —
      // it is `visibility: 'internal'`, which the outbound bridge never delivers.
      const proposalResponse = await apiRequest(request, 'POST', '/api/messages', {
        token,
        data: {
          type: CHANNEL_DISCORD_AI_PROPOSAL_MESSAGE_TYPE,
          visibility: 'internal',
          sourceEntityType: CHANNEL_DISCORD_AI_PROPOSAL_SOURCE_ENTITY_TYPE,
          sourceEntityId: inbound.messageId,
          recipients: [{ userId, type: 'to' }],
          subject: 'Asked whether they may write in Polish.',
          body: 'Oczywiście, piszcie po polsku — odpowiemy w tym samym języku.',
          bodyFormat: 'markdown',
          isDraft: false,
        },
      })
      expect(proposalResponse.status(), 'POST /api/messages should file the proposal').toBe(201)
      const proposal = await readJsonSafe<{ id?: string }>(proposalResponse)
      const proposalId = proposal?.id
      expect(proposalId, 'the proposal response should include its message id').toBeTruthy()

      // The approve action, dispatched the way the inbox dispatches it. This is
      // the call that used to fail with
      // `externalEmail is required when visibility is public`.
      const approveResponse = await apiRequest(
        request,
        'POST',
        `/api/messages/${proposalId}/actions/${CHANNEL_DISCORD_AI_PROPOSAL_APPROVE_ACTION_ID}`,
        { token, data: {} },
      )

      expect(
        approveResponse.status(),
        'Approving a reply must not be rejected for a missing externalEmail — ' +
          'the sender is an opaque handle and has no address (#5601)',
      ).toBe(200)

      const approved = await readJsonSafe<{
        ok?: boolean
        actionId?: string
        result?: { ok?: boolean; sentMessageId?: string }
      }>(approveResponse)
      expect(approved?.ok).toBe(true)
      expect(approved?.actionId).toBe(CHANNEL_DISCORD_AI_PROPOSAL_APPROVE_ACTION_ID)
      expect(approved?.result?.sentMessageId, 'the approved reply should have been composed').toBeTruthy()
    } finally {
      await deleteChannelIfExists(request, token, channelId)
    }
  })
})
