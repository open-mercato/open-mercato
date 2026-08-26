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
 * TC-CHANNEL-DISCORD-004 — reactions on a Discord-provider message.
 * Source: .ai/specs/2026-06-19-discord-communication-channel-integration.md
 *
 * `MESSAGE_REACTION_ADD` / `MESSAGE_REACTION_REMOVE` are bridged into the hub's
 * existing reaction routes, which resolve the owning channel through the
 * `ChannelThreadMapping` an inbound message leaves behind. This spec proves that
 * resolution works when the inbound traffic carries `providerKey: 'discord'` —
 * i.e. the provider needs no reaction storage of its own — by adding and then
 * removing a reaction on a seeded Discord message.
 *
 * Driven via the env-gated test-seed fixture (`OM_ENABLE_TEST_CHANNEL_SEEDING`);
 * skips when the gate is off.
 */
test.describe('TC-CHANNEL-DISCORD-004: reactions round-trip on a discord message', () => {
  test('a reaction can be added to and removed from a discord-provider message', async ({
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
        displayName: `TC-CHANNEL-DISCORD-004 ${stamp}`,
        externalIdentifier: `discord-004-${stamp}@test-seed.local`,
      })

      const seeded = await seedInboundMessage(request, token, {
        channelId,
        providerKey: 'discord',
        from: `discord-user-${stamp}`,
        subject: `Discord reaction target ${stamp}`,
        bodyText: 'react to me',
        messageId: `discord-message-${stamp}`,
        // The reaction route resolves the owning channel through this mapping.
        createThreadMapping: true,
      })

      const added = await apiRequest(
        request,
        'POST',
        `/api/communication_channels/messages/${seeded.messageId}/reactions`,
        { token, data: { emoji: '👍' } },
      )
      expect(added.status(), 'adding a reaction to a discord message should return 201').toBe(201)
      const addedBody = await readJsonSafe<{ id?: string; emoji?: string; messageId?: string }>(added)
      expect(addedBody?.emoji, 'the reaction echoes the emoji').toBe('👍')
      expect(addedBody?.messageId, 'the reaction is bound to the seeded discord message').toBe(
        seeded.messageId,
      )

      const reactionId = addedBody?.id
      expect(reactionId, 'the reaction response must carry an id to remove it by').toBeTruthy()
      const removed = await apiRequest(
        request,
        'DELETE',
        `/api/communication_channels/messages/${seeded.messageId}/reactions/${reactionId}`,
        { token },
      )
      expect(removed.status(), 'removing the reaction should return 204').toBe(204)
    } finally {
      await deleteChannelIfExists(request, token, channelId)
    }
  })
})
