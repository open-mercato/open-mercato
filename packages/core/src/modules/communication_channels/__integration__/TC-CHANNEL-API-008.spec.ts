import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createUserFixture, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  deleteChannelIfExists,
  isChannelSeedingAvailable,
  purgeSeededInboundMessage,
  seedConnectedChannel,
  seedInboundMessage,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'

type ReassignLog = { id: string; undoToken: string | null; executionState: string }

async function findReassignLog(
  request: APIRequestContext,
  token: string,
  conversationId: string,
): Promise<ReassignLog> {
  const query = new URLSearchParams({
    resourceKind: 'communication_channels.channel',
    resourceId: conversationId,
    pageSize: '10',
  })
  const response = await apiRequest(request, 'GET', `/api/audit_logs/audit-logs/actions?${query.toString()}`, { token })
  expect(response.status(), 'action log list should load').toBe(200)
  const body = await readJsonSafe<{ items?: Array<ReassignLog & { commandId?: string }> }>(response)
  const log = (body?.items ?? []).find((item) => item.commandId === 'communication_channels.conversation.reassign')
  expect(log, 'the owner reassignment should be recorded in the action log').toBeTruthy()
  return log as ReassignLog
}

/**
 * TC-CHANNEL-API-008 — PUT /threads/[threadId]/assign enforces personal-mailbox privacy.
 * Source: https://github.com/open-mercato/open-mercato/issues/3832
 *
 * The test-seed fixture connects a personal channel owned by the calling admin.
 * A second admin of the same organization holds `communication_channels.assign`
 * but does not own the mailbox, so reassigning its thread must be masked as 404
 * and leave the assignment untouched; the owner can still reassign it. Redoing
 * the owner's undone reassignment as the non-owner (who holds
 * `audit_logs.redo_tenant`) must be refused without consuming the redo, and the
 * owner's own redo must still succeed afterwards.
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
    let seeded: { channelLinkId: string; messageId: string; conversationId: string } | null = null
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
      seeded = await seedInboundMessage(request, ownerToken, {
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

      const reassignLog = await findReassignLog(request, ownerToken, seeded.conversationId)
      expect(reassignLog.undoToken, 'the owner reassignment should be undoable').toBeTruthy()
      const undone = await apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/undo', {
        token: ownerToken,
        data: { undoToken: reassignLog.undoToken },
      })
      expect(undone.status(), 'the owner can undo their reassignment').toBe(200)

      const deniedRedo = await apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/redo', {
        token: otherToken,
        data: { logId: reassignLog.id },
      })
      expect(deniedRedo.status(), 'a non-owner redo must be refused with the masked 404').toBe(404)
      expect(
        (await findReassignLog(request, ownerToken, seeded.conversationId)).executionState,
        'a refused redo must leave the log undone',
      ).toBe('undone')

      const ownerRedo = await apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/redo', {
        token: ownerToken,
        data: { logId: reassignLog.id },
      })
      expect(ownerRedo.status(), 'the owner can still redo after a refused attempt').toBe(200)
      const reapplied = await apiRequest(
        request,
        'PUT',
        `/api/communication_channels/threads/${threadId}/assign`,
        { token: ownerToken, data: { assignedUserId: ownerScope.userId } },
      )
      const reappliedBody = await readJsonSafe<{ unchanged?: boolean }>(reapplied)
      expect(reappliedBody?.unchanged, 'the owner redo re-applied the assignment').toBe(true)
    } finally {
      await deleteUserIfExists(request, ownerToken, otherUserId)
      await purgeSeededInboundMessage(request, ownerToken, channelId, seeded)
      await deleteChannelIfExists(request, ownerToken, channelId)
    }
  })
})
