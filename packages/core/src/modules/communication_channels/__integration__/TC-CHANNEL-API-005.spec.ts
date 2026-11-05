import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  deleteChannelIfExists,
  isChannelSeedingAvailable,
  seedConnectedChannel,
  seedInboundMessage,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'

/**
 * TC-CHANNEL-API-005 — add and remove a reaction on a channel-linked message.
 * Source: https://github.com/open-mercato/open-mercato/issues/2486
 *
 * Reacting resolves the owning channel through the thread mapping, so the inbound
 * message is seeded with `createThreadMapping: true`. The channel owner (the
 * seeding caller) adds a reaction (201) and removes it by id (204).
 *
 * Driven via the env-gated test-seed fixture (`OM_ENABLE_TEST_CHANNEL_SEEDING`);
 * skips when the gate is off.
 */
test.describe('TC-CHANNEL-API-005: add/remove a reaction', () => {
  test('POST creates a reaction and DELETE removes it', async ({ request }) => {
    test.slow()
    let token: string | null = null
    let channelId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const seedingAvailable = await isChannelSeedingAvailable(request, token)
      test.skip(
        !seedingAvailable,
        'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled in this environment; cannot seed a channel-linked message.',
      )

      const stamp = Date.now()
      channelId = await seedConnectedChannel(request, token, {
        displayName: `TC-CHANNEL-API-005 ${stamp}`,
        externalIdentifier: `api-005-${stamp}@test-seed.local`,
      })
      const seeded = await seedInboundMessage(request, token, {
        channelId,
        from: `sender-${stamp}@example.com`,
        to: [`api-005-${stamp}@test-seed.local`],
        subject: `Reaction seed ${stamp}`,
        bodyText: 'react to me',
        createThreadMapping: true,
      })

      // Add a reaction.
      const addResponse = await apiRequest(
        request,
        'POST',
        `/api/communication_channels/messages/${seeded.messageId}/reactions`,
        { token, data: { emoji: '👍' } },
      )
      expect(addResponse.status(), 'adding a reaction should return 201').toBe(201)
      const addBody = await readJsonSafe<{ id?: string; emoji?: string; messageId?: string }>(addResponse)
      const reactionId = expectId(addBody?.id, 'reaction response should include the new reaction id')
      expect(addBody?.emoji, 'reaction echoes the emoji').toBe('👍')
      expect(addBody?.messageId, 'reaction is bound to the seeded message').toBe(seeded.messageId)

      // Remove it by id.
      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/communication_channels/messages/${seeded.messageId}/reactions/${reactionId}`,
        { token },
      )
      expect(deleteResponse.status(), 'removing a reaction should return 204').toBe(204)
    } finally {
      await deleteChannelIfExists(request, token, channelId)
    }
  })
})
