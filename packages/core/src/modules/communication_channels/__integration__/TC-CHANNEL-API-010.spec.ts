import { randomInt } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  deleteChannelIfExists,
  isChannelSeedingAvailable,
  seedConnectedChannel,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'

/**
 * TC-CHANNEL-API-010 — undoing a channel delete never revives a second live
 * connection next to the one the user reconnected in the meantime.
 *
 * Connect only heals live rows, so delete → reconnect inserts a new channel.
 * Undo of the original delete used to restore the old row next to it: two active
 * channels for one identifier-less chat connection, or a generic "Undo failed"
 * when the mailbox unique index caught it. The undo is now refused with a
 * translated 409, and it stays available: once the newer connection is deleted
 * the same undo token restores the original channel.
 *
 * Runs as a dedicated user so no other spec's channels share its identity.
 * Driven via the env-gated test-seed fixture (`OM_ENABLE_TEST_CHANNEL_SEEDING`);
 * skips when the gate is off.
 */
const UNDO_PATH = '/api/audit_logs/audit-logs/actions/undo'
const DUPLICATE_MESSAGE =
  'This channel was connected again after it was deleted. Delete the newer connection before undoing this delete.'
const PASSWORD = 'Valid1!Pass'

type Fixture = {
  adminToken: string | null
  roleId: string | null
  userId: string | null
  userToken: string | null
  email: string
  channelIds: string[]
}

async function createChannelOwner(request: APIRequestContext, label: string): Promise<Fixture> {
  const stamp = `${Date.now()}-${randomInt(1_000_000)}`
  const fixture: Fixture = {
    adminToken: null,
    roleId: null,
    userId: null,
    userToken: null,
    email: `qa-channel-api-010-${label}-${stamp}@acme.com`,
    channelIds: [],
  }
  fixture.adminToken = await getAuthToken(request, 'admin')
  const seedingAvailable = await isChannelSeedingAvailable(request, fixture.adminToken)
  test.skip(
    !seedingAvailable,
    'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled in this environment; cannot seed connected channels.',
  )
  const scope = getTokenScope(fixture.adminToken)
  const roleName = `qa_channel_api_010_${label}_${stamp}`
  fixture.roleId = await createRoleFixture(request, fixture.adminToken, { name: roleName, tenantId: scope.tenantId })
  await setRoleAclFeatures(request, fixture.adminToken, {
    roleId: fixture.roleId,
    features: [
      'communication_channels.connect_user_channel',
      'audit_logs.view_self',
      'audit_logs.undo_self',
    ],
  })
  fixture.userId = await createUserFixture(request, fixture.adminToken, {
    email: fixture.email,
    password: PASSWORD,
    organizationId: scope.organizationId,
    roles: [roleName],
    name: `QA Channel API 010 ${label}`,
  })
  fixture.userToken = await getAuthToken(request, fixture.email, PASSWORD)
  return fixture
}

async function cleanUp(request: APIRequestContext, fixture: Fixture | null): Promise<void> {
  if (!fixture) return
  for (const channelId of fixture.channelIds) {
    await deleteChannelIfExists(request, fixture.userToken, channelId)
  }
  await deleteUserIfExists(request, fixture.adminToken, fixture.userId)
  await deleteRoleIfExists(request, fixture.adminToken, fixture.roleId)
}

async function seed(
  request: APIRequestContext,
  fixture: Fixture,
  input: Parameters<typeof seedConnectedChannel>[2],
): Promise<string> {
  const channelId = await seedConnectedChannel(request, fixture.userToken as string, input)
  fixture.channelIds.push(channelId)
  return channelId
}

async function deleteChannel(request: APIRequestContext, token: string, channelId: string): Promise<void> {
  const response = await apiRequest(request, 'DELETE', `/api/communication_channels/channels/${channelId}`, { token })
  expect(response.status(), `DELETE channel ${channelId} should return 204`).toBe(204)
}

async function findDeleteUndoToken(request: APIRequestContext, token: string, channelId: string): Promise<string> {
  const query = new URLSearchParams({ resourceKind: 'communication_channels.channel', resourceId: channelId })
  const response = await apiRequest(request, 'GET', `/api/audit_logs/audit-logs/actions?${query.toString()}`, { token })
  expect(response.status(), 'GET audit-logs actions should return 200').toBe(200)
  const body = await readJsonSafe<{
    items?: Array<{ commandId: string; executionState: string; undoToken: string | null }>
  }>(response)
  const entry = (body?.items ?? []).find(
    (item) => item.commandId === 'communication_channels.channel.delete' && item.executionState === 'done',
  )
  expect(entry?.undoToken, 'the channel delete should leave an undo token').toBeTruthy()
  return entry?.undoToken as string
}

async function listLiveChannelIds(request: APIRequestContext, token: string): Promise<string[]> {
  const response = await apiRequest(request, 'GET', '/api/communication_channels/me/channels?pageSize=100', { token })
  expect(response.status(), 'GET /me/channels should return 200').toBe(200)
  const body = await readJsonSafe<{ items?: Array<{ id: string }> }>(response)
  return (body?.items ?? []).map((item) => item.id)
}

async function undo(request: APIRequestContext, token: string, undoToken: string) {
  const response = await apiRequest(request, 'POST', UNDO_PATH, { token, data: { undoToken } })
  const body = await readJsonSafe<{ error?: string }>(response)
  return { status: response.status(), body }
}

test.describe('TC-CHANNEL-API-010: undo of a channel delete after a reconnect', () => {
  test('refuses to revive an identifier-less chat channel next to its reconnection, then restores once it is gone', async ({
    request,
  }) => {
    test.slow()
    let fixture: Fixture | null = null
    try {
      fixture = await createChannelOwner(request, 'chat')
      const token = fixture.userToken as string
      const original = await seed(request, fixture, { displayName: 'API-010 chat original', providerFlavor: 'chat' })
      await deleteChannel(request, token, original)
      const undoToken = await findDeleteUndoToken(request, token, original)

      const reconnected = await seed(request, fixture, { displayName: 'API-010 chat reconnected', providerFlavor: 'chat' })
      expect(reconnected, 'a reconnect after the delete inserts a new channel row').not.toBe(original)

      const refused = await undo(request, token, undoToken)
      expect(refused.status, 'undo must be refused while the reconnected channel is live').toBe(409)
      expect(refused.body?.error).toBe(DUPLICATE_MESSAGE)
      const liveAfterRefusal = await listLiveChannelIds(request, token)
      expect(liveAfterRefusal).toContain(reconnected)
      expect(liveAfterRefusal, 'the refused undo must not revive the deleted channel').not.toContain(original)

      await deleteChannel(request, token, reconnected)
      const restored = await undo(request, token, undoToken)
      expect(restored.status, 'the same undo succeeds once the newer connection is deleted').toBe(200)
      const liveAfterRestore = await listLiveChannelIds(request, token)
      expect(liveAfterRestore).toContain(original)
      expect(liveAfterRestore).not.toContain(reconnected)
    } finally {
      await cleanUp(request, fixture)
    }
  })

  test('answers a translated 409 instead of a generic failure when the same mailbox was reconnected', async ({
    request,
  }) => {
    test.slow()
    let fixture: Fixture | null = null
    try {
      fixture = await createChannelOwner(request, 'mail')
      const token = fixture.userToken as string
      const mailbox = `qa-channel-api-010-${Date.now()}@test-seed.local`
      const original = await seed(request, fixture, { displayName: 'API-010 mail original', externalIdentifier: mailbox })
      await deleteChannel(request, token, original)
      const undoToken = await findDeleteUndoToken(request, token, original)
      const reconnected = await seed(request, fixture, { displayName: 'API-010 mail reconnected', externalIdentifier: mailbox })
      expect(reconnected).not.toBe(original)

      const refused = await undo(request, token, undoToken)
      expect(refused.status).toBe(409)
      expect(refused.body?.error).toBe(DUPLICATE_MESSAGE)
      const live = await listLiveChannelIds(request, token)
      expect(live).toContain(reconnected)
      expect(live).not.toContain(original)
    } finally {
      await cleanUp(request, fixture)
    }
  })

  test('shows the refusal on the audit log page', async ({ page, request }) => {
    test.slow()
    let fixture: Fixture | null = null
    try {
      fixture = await createChannelOwner(request, 'ui')
      const token = fixture.userToken as string
      const original = await seed(request, fixture, { displayName: 'API-010 ui original', providerFlavor: 'chat' })
      await deleteChannel(request, token, original)
      await seed(request, fixture, { displayName: 'API-010 ui reconnected', providerFlavor: 'chat' })

      const loginForm = new URLSearchParams()
      loginForm.set('email', fixture.email)
      loginForm.set('password', PASSWORD)
      const loginResponse = await page.request.post('/api/auth/login', {
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        data: loginForm.toString(),
      })
      expect(loginResponse.ok(), 'the channel owner should log in').toBe(true)

      await page.goto('/backend/audit-logs')
      const deleteRow = page.getByRole('row').filter({ hasText: 'communication_channels.channel.delete' }).first()
      await expect(deleteRow).toBeVisible({ timeout: 20_000 })
      const undoResponse = page.waitForResponse(
        (response) => response.url().includes(UNDO_PATH) && response.request().method() === 'POST',
      )
      await deleteRow.getByRole('button', { name: 'Undo last action' }).click()
      expect((await undoResponse).status(), 'the UI undo must be refused').toBe(409)
      await expect(page.getByText(DUPLICATE_MESSAGE).first()).toBeVisible({ timeout: 10_000 })
      expect(await listLiveChannelIds(request, token)).not.toContain(original)
    } finally {
      await cleanUp(request, fixture)
    }
  })
})
