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
 * TC-CHANNEL-API-002 — POST set-primary marks exactly one channel primary.
 * Source: https://github.com/open-mercato/open-mercato/issues/2486
 *
 * "Primary" is a per-user invariant (a partial unique index on user_id), so the
 * test runs against a DEDICATED user with two seeded channels. This isolates the
 * "only one primary" assertion from the shared admin and from parallel specs:
 * `GET /me/channels` then lists exactly the two channels under test.
 *
 * Driven via the env-gated test-seed fixture (`OM_ENABLE_TEST_CHANNEL_SEEDING`);
 * skips when the gate is off.
 */
async function listPrimaryChannelIds(request: APIRequestContext, token: string): Promise<string[]> {
  const response = await apiRequest(request, 'GET', '/api/communication_channels/me/channels', { token })
  expect(response.status(), 'GET /me/channels should return 200').toBe(200)
  const body = await readJsonSafe<{ items?: Array<{ id: string; isPrimary: boolean }> }>(response)
  return (body?.items ?? []).filter((item) => item.isPrimary).map((item) => item.id)
}

test.describe('TC-CHANNEL-API-002: set-primary keeps a single primary per user', () => {
  test('set-primary moves the primary flag and supersedes the previous one', async ({ request }) => {
    test.slow()
    const stamp = Date.now()
    let adminToken: string | null = null
    let userToken: string | null = null
    let userId: string | null = null
    let roleId: string | null = null
    let channelA: string | null = null
    let channelB: string | null = null
    try {
      adminToken = await getAuthToken(request, 'admin')
      const seedingAvailable = await isChannelSeedingAvailable(request, adminToken)
      test.skip(
        !seedingAvailable,
        'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled in this environment; cannot seed connected channels.',
      )

      const scope = getTokenScope(adminToken)
      const roleName = `qa_channel_api_002_${stamp}`
      roleId = await createRoleFixture(request, adminToken, { name: roleName, tenantId: scope.tenantId })
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: ['communication_channels.connect_user_channel'],
      })

      const userEmail = `qa-channel-api-002-${stamp}@acme.com`
      const userPassword = 'Valid1!Pass'
      userId = await createUserFixture(request, adminToken, {
        email: userEmail,
        password: userPassword,
        organizationId: scope.organizationId,
        roles: [roleName],
        name: 'QA Channel API 002 User',
      })
      userToken = await getAuthToken(request, userEmail, userPassword)

      channelA = await seedConnectedChannel(request, userToken, { displayName: `API-002 A ${stamp}` })
      channelB = await seedConnectedChannel(request, userToken, { displayName: `API-002 B ${stamp}` })

      // Set channel A primary.
      const setA = await apiRequest(
        request,
        'POST',
        `/api/communication_channels/channels/${channelA}/set-primary`,
        { token: userToken },
      )
      expect(setA.status(), 'set-primary A should return 200').toBe(200)
      const setABody = await readJsonSafe<{ isPrimary?: boolean }>(setA)
      expect(setABody?.isPrimary, 'channel A is now primary').toBe(true)
      expect(await listPrimaryChannelIds(request, userToken), 'exactly A is primary after setting A').toEqual([
        channelA,
      ])

      // Set channel B primary — supersedes A.
      const setB = await apiRequest(
        request,
        'POST',
        `/api/communication_channels/channels/${channelB}/set-primary`,
        { token: userToken },
      )
      expect(setB.status(), 'set-primary B should return 200').toBe(200)
      const setBBody = await readJsonSafe<{ isPrimary?: boolean; previousPrimaryChannelId?: string | null }>(setB)
      expect(setBBody?.isPrimary, 'channel B is now primary').toBe(true)
      expect(setBBody?.previousPrimaryChannelId, 'B supersedes A as the previous primary').toBe(channelA)
      expect(await listPrimaryChannelIds(request, userToken), 'exactly B is primary after setting B').toEqual([
        channelB,
      ])
    } finally {
      await deleteChannelIfExists(request, userToken, channelA)
      await deleteChannelIfExists(request, userToken, channelB)
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
