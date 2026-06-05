import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  deleteChannelIfExists,
  isChannelSeedingAvailable,
  seedConnectedChannel,
  seedInboundMessage,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'

/**
 * TC-CHANNEL-API-006 — PUT /threads/[threadId]/assign reassigns a conversation.
 * Source: https://github.com/open-mercato/open-mercato/issues/2486
 *
 * Assignment resolves the conversation through the thread mapping, so the inbound
 * message is seeded with an explicit `messageThreadId` and `createThreadMapping:
 * true`. Assigning the thread to a live tenant user updates the owner and echoes
 * the previous (none) and next assignee.
 *
 * Driven via the env-gated test-seed fixture (`OM_ENABLE_TEST_CHANNEL_SEEDING`);
 * skips when the gate is off.
 */
test.describe('TC-CHANNEL-API-006: assign a channel-linked thread', () => {
  test('assigns a seeded thread to a tenant user', async ({ request }) => {
    test.slow()
    let token: string | null = null
    let channelId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const seedingAvailable = await isChannelSeedingAvailable(request, token)
      test.skip(
        !seedingAvailable,
        'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled in this environment; cannot seed a channel-linked thread.',
      )

      const scope = getTokenScope(token)
      const stamp = Date.now()
      const threadId = randomUUID()
      channelId = await seedConnectedChannel(request, token, {
        displayName: `TC-CHANNEL-API-006 ${stamp}`,
        externalIdentifier: `api-006-${stamp}@test-seed.local`,
      })
      await seedInboundMessage(request, token, {
        channelId,
        from: `sender-${stamp}@example.com`,
        to: [`api-006-${stamp}@test-seed.local`],
        subject: `Assign seed ${stamp}`,
        bodyText: 'assign me',
        messageThreadId: threadId,
        createThreadMapping: true,
      })

      const response = await apiRequest(
        request,
        'PUT',
        `/api/communication_channels/threads/${threadId}/assign`,
        { token, data: { assignedUserId: scope.userId } },
      )
      expect(response.status(), 'assign should return 200').toBe(200)

      const body = await readJsonSafe<{
        threadId?: string
        assignedUserId?: string | null
        previousAssignedUserId?: string | null
      }>(response)
      expect(body?.threadId, 'assign echoes the thread id').toBe(threadId)
      expect(body?.assignedUserId, 'the conversation is now owned by the target user').toBe(scope.userId)
      expect(body?.previousAssignedUserId ?? null, 'the seeded thread had no prior owner').toBeNull()
    } finally {
      await deleteChannelIfExists(request, token, channelId)
    }
  })
})
