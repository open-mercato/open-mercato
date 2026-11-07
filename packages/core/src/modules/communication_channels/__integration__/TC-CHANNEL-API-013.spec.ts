import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  isChannelSeedingAvailable,
  purgeSeededInboundMessage,
  seedInboundMessage,
  seedSystemEmailChannel,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'

type ReassignLog = { id: string; undoToken: string | null; executionState: string; commandId?: string }

const REASSIGN_COMMAND_ID = 'communication_channels.conversation.reassign'
const CONFLICT_MESSAGE =
  'This conversation was reassigned again after this change. Undo was refused so the newer assignment is kept.'

async function listReassignLogs(
  request: APIRequestContext,
  token: string,
  conversationId: string,
): Promise<ReassignLog[]> {
  const query = new URLSearchParams({
    resourceKind: 'communication_channels.channel',
    resourceId: conversationId,
    pageSize: '20',
  })
  const response = await apiRequest(request, 'GET', `/api/audit_logs/audit-logs/actions?${query.toString()}`, { token })
  expect(response.status(), 'action log list should load').toBe(200)
  const body = await readJsonSafe<{ items?: ReassignLog[] }>(response)
  return (body?.items ?? []).filter((item) => item.commandId === REASSIGN_COMMAND_ID)
}

async function findReassignLog(
  request: APIRequestContext,
  token: string,
  conversationId: string,
  match: (log: ReassignLog) => boolean,
): Promise<ReassignLog> {
  const log = (await listReassignLogs(request, token, conversationId)).find(match)
  expect(log, 'the reassignment should be recorded in the action log').toBeTruthy()
  return log as ReassignLog
}

async function assign(
  request: APIRequestContext,
  token: string,
  threadId: string,
  assignedUserId: string | null,
): Promise<{ status: number; body: { assignedUserId?: string | null; unchanged?: boolean } | null }> {
  const response = await apiRequest(request, 'PUT', `/api/communication_channels/threads/${threadId}/assign`, {
    token,
    data: { assignedUserId },
  })
  return {
    status: response.status(),
    body: await readJsonSafe<{ assignedUserId?: string | null; unchanged?: boolean }>(response),
  }
}

/**
 * TC-CHANNEL-API-013 — undoing a thread reassignment never discards a newer one.
 *
 * On a shared (tenant-level) channel two operators holding
 * `communication_channels.assign` reassign the same thread: the first assigns
 * it to themself, the second then takes it over. The undo route only offers
 * each actor their own latest action, so the first operator can still undo
 * their older reassignment. That undo must be refused with a translated 409 and
 * leave the second operator's assignment in place; once the newer reassignment
 * is undone, the older one undoes normally.
 *
 * Driven via the env-gated test-seed fixture (`OM_ENABLE_TEST_CHANNEL_SEEDING`);
 * skips when the gate is off.
 */
test.describe('TC-CHANNEL-API-013: reassign undo keeps a newer reassignment', () => {
  test('refuses to undo a reassignment that a later reassignment superseded', async ({ request }) => {
    test.slow()
    let firstToken: string | null = null
    let channelId: string | null = null
    let secondUserId: string | null = null
    let seeded: { channelLinkId: string; messageId: string; conversationId: string } | null = null
    try {
      firstToken = await getAuthToken(request, 'admin')
      const seedingAvailable = await isChannelSeedingAvailable(request, firstToken)
      test.skip(
        !seedingAvailable,
        'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled in this environment; cannot seed a channel-linked thread.',
      )

      const firstScope = getTokenScope(firstToken)
      const stamp = Date.now()
      const threadId = randomUUID()
      channelId = await seedSystemEmailChannel(request, firstToken)
      seeded = await seedInboundMessage(request, firstToken, {
        channelId,
        from: `sender-${stamp}@example.com`,
        to: [`api-013-${stamp}@test-seed.local`],
        subject: `Reassign undo seed ${stamp}`,
        bodyText: 'who owns me',
        messageThreadId: threadId,
        createThreadMapping: true,
      })

      const secondEmail = `tc-channel-api-013-${stamp}@example.com`
      const secondPassword = 'Valid1!Pass'
      secondUserId = await createUserFixture(request, firstToken, {
        email: secondEmail,
        password: secondPassword,
        organizationId: firstScope.organizationId,
        roles: ['admin'],
      })
      const secondToken = await getAuthToken(request, secondEmail, secondPassword)

      const firstAssign = await assign(request, firstToken, threadId, firstScope.userId)
      expect(firstAssign.status, 'the first operator assigns the thread to themself').toBe(200)
      const firstLog = await findReassignLog(request, firstToken, seeded.conversationId, () => true)
      expect(firstLog.undoToken, 'the first reassignment should be undoable').toBeTruthy()

      const secondAssign = await assign(request, secondToken, threadId, secondUserId)
      expect(secondAssign.status, 'the second operator takes the thread over').toBe(200)
      const secondLog = await findReassignLog(
        request,
        firstToken,
        seeded.conversationId,
        (log) => log.id !== firstLog.id,
      )

      const staleUndo = await apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/undo', {
        token: firstToken,
        data: { undoToken: firstLog.undoToken },
      })
      expect(staleUndo.status(), 'an undo superseded by a newer reassignment must be refused').toBe(409)
      const staleBody = await readJsonSafe<{ error?: string; code?: string }>(staleUndo)
      expect(staleBody?.code).toBe('communication_channels.errors.reassignUndoConflict')
      expect(staleBody?.error, 'the refusal carries a translated message, not the key').toBe(CONFLICT_MESSAGE)
      expect(
        (await findReassignLog(request, firstToken, seeded.conversationId, (log) => log.id === firstLog.id)).executionState,
        'a refused undo must leave the first reassignment done',
      ).toBe('done')
      const kept = await assign(request, secondToken, threadId, secondUserId)
      expect(kept.body?.unchanged, 'the newer assignment must survive the refused undo').toBe(true)

      const newerUndo = await apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/undo', {
        token: secondToken,
        data: { undoToken: secondLog.undoToken },
      })
      expect(newerUndo.status(), 'the newer reassignment undoes normally').toBe(200)
      const restored = await assign(request, firstToken, threadId, firstScope.userId)
      expect(restored.body?.unchanged, 'undoing the newer reassignment restores the first owner').toBe(true)

      const olderUndo = await apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/undo', {
        token: firstToken,
        data: { undoToken: firstLog.undoToken },
      })
      expect(olderUndo.status(), 'the first reassignment undoes once it is current again').toBe(200)
      const unassigned = await assign(request, firstToken, threadId, null)
      expect(unassigned.body?.unchanged, 'the thread is back to unassigned').toBe(true)
    } finally {
      await deleteUserIfExists(request, firstToken, secondUserId)
      await purgeSeededInboundMessage(request, firstToken, channelId, seeded)
    }
  })

  test('the audit log Undo button shows the refusal and keeps the newer owner', async ({ page, request }) => {
    test.slow()
    let adminToken: string | null = null
    let superadminToken: string | null = null
    let channelId: string | null = null
    let roleId: string | null = null
    let operatorId: string | null = null
    let seeded: { channelLinkId: string; messageId: string; conversationId: string } | null = null
    try {
      adminToken = await getAuthToken(request, 'admin')
      const seedingAvailable = await isChannelSeedingAvailable(request, adminToken)
      test.skip(
        !seedingAvailable,
        'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled in this environment; cannot seed a channel-linked thread.',
      )
      superadminToken = await getAuthToken(request, 'superadmin')

      const adminScope = getTokenScope(adminToken)
      const stamp = Date.now()
      const threadId = randomUUID()
      channelId = await seedSystemEmailChannel(request, adminToken)
      seeded = await seedInboundMessage(request, adminToken, {
        channelId,
        from: `sender-ui-${stamp}@example.com`,
        to: [`api-013-ui-${stamp}@test-seed.local`],
        subject: `Reassign undo UI seed ${stamp}`,
        bodyText: 'who owns me now',
        messageThreadId: threadId,
        createThreadMapping: true,
      })

      roleId = await createRoleFixture(request, superadminToken, { name: `tc-channel-api-013-${stamp}`, tenantId: adminScope.tenantId })
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: [
          'communication_channels.view',
          'communication_channels.assign',
          'audit_logs.view_self',
          'audit_logs.undo_self',
        ],
        organizations: [adminScope.organizationId],
      })
      const operatorEmail = `tc-channel-api-013-ui-${stamp}@example.com`
      const operatorPassword = 'Valid1!Pass'
      operatorId = await createUserFixture(request, superadminToken, {
        email: operatorEmail,
        password: operatorPassword,
        organizationId: adminScope.organizationId,
        roles: [roleId],
        name: 'TC-CHANNEL-API-013 Operator',
      })
      const operatorToken = await getAuthToken(request, operatorEmail, operatorPassword)

      expect((await assign(request, operatorToken, threadId, operatorId)).status, 'the operator takes the thread').toBe(200)
      expect((await assign(request, adminToken, threadId, adminScope.userId)).status, 'the admin takes it over').toBe(200)

      const loginForm = new URLSearchParams()
      loginForm.set('email', operatorEmail)
      loginForm.set('password', operatorPassword)
      const loginResponse = await page.request.post('/api/auth/login', {
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        data: loginForm.toString(),
      })
      expect(loginResponse.ok(), 'the operator should log in').toBe(true)

      await page.goto('/backend/audit-logs')
      const reassignRow = page.getByRole('row').filter({ hasText: REASSIGN_COMMAND_ID }).first()
      await expect(reassignRow).toBeVisible({ timeout: 20_000 })
      const undoResponse = page.waitForResponse((response) => (
        response.url().includes('/api/audit_logs/audit-logs/actions/undo') && response.request().method() === 'POST'
      ))
      await reassignRow.getByRole('button', { name: 'Undo this action' }).click()
      expect((await undoResponse).status(), 'the UI undo must be refused').toBe(409)
      await expect(page.getByText(CONFLICT_MESSAGE).first()).toBeVisible({ timeout: 10_000 })

      const kept = await assign(request, adminToken, threadId, adminScope.userId)
      expect(kept.body?.unchanged, 'the admin assignment survives the refused UI undo').toBe(true)
    } finally {
      await deleteUserIfExists(request, superadminToken, operatorId)
      await deleteRoleIfExists(request, superadminToken, roleId)
      await purgeSeededInboundMessage(request, adminToken, channelId, seeded)
    }
  })
})
