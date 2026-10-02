import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createUserFixture, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  deleteChannelIfExists,
  isChannelSeedingAvailable,
  seedConnectedChannel,
  seedInboundMessage,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'

/**
 * TC-CHANNEL-API-008 — PUT /threads/[threadId]/assign enforces personal-mailbox privacy.
 * Source: https://github.com/open-mercato/open-mercato/issues/3832
 *
 * The test-seed fixture connects a personal channel owned by the calling admin.
 * A second admin of the same organization holds `communication_channels.assign`
 * but does not own the mailbox, so reassigning its thread must be masked as 404
 * and leave the assignment untouched; the owner can still reassign it.
 *
 * Driven via the env-gated test-seed fixture (`OM_ENABLE_TEST_CHANNEL_SEEDING`);
 * skips when the gate is off.
 */
test.describe('TC-CHANNEL-API-008: personal-mailbox thread reassignment is owner-only', () => {
  test('a non-owner admin cannot reassign a thread on another user\'s personal mailbox', async ({ request }) => {
    test.slow()
    let ownerToken: string | null = null
    let channelId: string | null = null
    let otherUserId: string | null = null
    try {
      ownerToken = await getAuthToken(request, 'admin')
      const seedingAvailable = await isChannelSeedingAvailable(request, ownerToken)
      test.skip(
        !seedingAvailable,
        'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled in this environment; cannot seed a channel-linked thread.',
      )

      const ownerScope = getTokenScope(ownerToken)
      const stamp = Date.now()
      const threadId = randomUUID()
      channelId = await seedConnectedChannel(request, ownerToken, {
        displayName: `TC-CHANNEL-API-008 ${stamp}`,
        externalIdentifier: `api-008-${stamp}@test-seed.local`,
      })
      await seedInboundMessage(request, ownerToken, {
        channelId,
        from: `sender-${stamp}@example.com`,
        to: [`api-008-${stamp}@test-seed.local`],
        subject: `Privacy seed ${stamp}`,
        bodyText: 'not yours',
        messageThreadId: threadId,
        createThreadMapping: true,
      })

      const otherEmail = `tc-channel-api-008-${stamp}@example.com`
      const otherPassword = 'Valid1!Pass'
      otherUserId = await createUserFixture(request, ownerToken, {
        email: otherEmail,
        password: otherPassword,
        organizationId: ownerScope.organizationId,
        roles: ['admin'],
      })
      const otherToken = await getAuthToken(request, otherEmail, otherPassword)

      const denied = await apiRequest(
        request,
        'PUT',
        `/api/communication_channels/threads/${threadId}/assign`,
        { token: otherToken, data: { assignedUserId: otherUserId } },
      )
      expect(denied.status(), 'a non-owner must not reassign a personal-mailbox thread').toBe(404)

      const allowed = await apiRequest(
        request,
        'PUT',
        `/api/communication_channels/threads/${threadId}/assign`,
        { token: ownerToken, data: { assignedUserId: ownerScope.userId } },
      )
      expect(allowed.status(), 'the mailbox owner can reassign their own thread').toBe(200)
      const body = await readJsonSafe<{
        assignedUserId?: string | null
        previousAssignedUserId?: string | null
      }>(allowed)
      expect(body?.assignedUserId).toBe(ownerScope.userId)
      expect(
        body?.previousAssignedUserId ?? null,
        'the denied request left the thread unassigned',
      ).toBeNull()
    } finally {
      await deleteUserIfExists(request, ownerToken, otherUserId)
      await deleteChannelIfExists(request, ownerToken, channelId)
    }
  })
})
