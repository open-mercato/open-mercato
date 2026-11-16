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
  disconnectSeededChannel,
  isChannelSeedingAvailable,
  seedConnectedChannel,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'

/**
 * TC-CHANNEL-API-011 — POST set-primary refuses a disconnected channel.
 *
 * Every path that disconnects a channel also clears its primary flag, and the
 * disconnected row stays listed. Promoting it again would leave the user with a
 * primary that cannot send while their working channel loses the flag. The route
 * must answer 409 `channel_disconnected` and leave the current primary in place.
 *
 * Runs against a DEDICATED user (primary is a per-user invariant) and skips when
 * `OM_ENABLE_TEST_CHANNEL_SEEDING` is off.
 */
async function listPrimaryChannelIds(request: APIRequestContext, token: string): Promise<string[]> {
  const response = await apiRequest(request, 'GET', '/api/communication_channels/me/channels', { token })
  expect(response.status(), 'GET /me/channels should return 200').toBe(200)
  const body = await readJsonSafe<{ items?: Array<{ id: string; isPrimary: boolean }> }>(response)
  return (body?.items ?? []).filter((item) => item.isPrimary).map((item) => item.id)
}

test.describe('TC-CHANNEL-API-011: set-primary refuses a disconnected channel', () => {
  test('a disconnected channel cannot take the primary flag', async ({ request }) => {
    test.slow()
    const stamp = Date.now()
    let adminToken: string | null = null
    let userToken: string | null = null
    let userId: string | null = null
    let roleId: string | null = null
    let liveChannel: string | null = null
    let disconnectedChannel: string | null = null
    try {
      adminToken = await getAuthToken(request, 'admin')
      const seedingAvailable = await isChannelSeedingAvailable(request, adminToken)
      test.skip(
        !seedingAvailable,
        'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled in this environment; cannot seed channels.',
      )

      const scope = getTokenScope(adminToken)
      const roleName = `qa_channel_api_011_${stamp}`
      roleId = await createRoleFixture(request, adminToken, { name: roleName, tenantId: scope.tenantId })
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: ['communication_channels.connect_user_channel'],
      })

      const userEmail = `qa-channel-api-011-${stamp}@acme.com`
      const userPassword = 'Valid1!Pass'
      userId = await createUserFixture(request, adminToken, {
        email: userEmail,
        password: userPassword,
        organizationId: scope.organizationId,
        roles: [roleName],
        name: 'QA Channel API 011 User',
      })
      userToken = await getAuthToken(request, userEmail, userPassword)

      liveChannel = await seedConnectedChannel(request, userToken, { displayName: `API-011 live ${stamp}` })
      disconnectedChannel = await seedConnectedChannel(request, userToken, { displayName: `API-011 gone ${stamp}` })
      await disconnectSeededChannel(request, userToken, disconnectedChannel)

      const setLive = await apiRequest(
        request,
        'POST',
        `/api/communication_channels/channels/${liveChannel}/set-primary`,
        { token: userToken },
      )
      expect(setLive.status(), 'set-primary on the connected channel should return 200').toBe(200)

      const setDisconnected = await apiRequest(
        request,
        'POST',
        `/api/communication_channels/channels/${disconnectedChannel}/set-primary`,
        { token: userToken },
      )
      expect(setDisconnected.status(), 'set-primary on a disconnected channel should return 409').toBe(409)
      const body = await readJsonSafe<{ error?: string; code?: string }>(setDisconnected)
      expect(body?.code).toBe('channel_disconnected')
      expect(typeof body?.error === 'string' && body.error.length > 0, 'refusal carries a message').toBe(true)

      expect(
        await listPrimaryChannelIds(request, userToken),
        'the connected channel stays the only primary',
      ).toEqual([liveChannel])
    } finally {
      await deleteChannelIfExists(request, userToken, liveChannel)
      await deleteChannelIfExists(request, userToken, disconnectedChannel)
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
