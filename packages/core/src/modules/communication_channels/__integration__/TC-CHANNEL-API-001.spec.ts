import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  deleteChannelIfExists,
  isChannelSeedingAvailable,
  seedConnectedChannel,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'

/**
 * TC-CHANNEL-API-001 — GET /channels/[id] returns metadata without credentials.
 * Source: https://github.com/open-mercato/open-mercato/issues/2486
 *
 * Positive-path coverage for the channel-detail route: a seeded, connected
 * channel is retrievable by id, the payload echoes its public metadata, and the
 * route never embeds raw credentials (only a vault `credentialsRef`).
 *
 * Driven via the env-gated test-seed fixture (`OM_ENABLE_TEST_CHANNEL_SEEDING`);
 * skips when the gate is off.
 */
test.describe('TC-CHANNEL-API-001: GET channel detail returns metadata, no credentials', () => {
  test('returns the seeded channel and never leaks credentials', async ({ request }) => {
    let token: string | null = null
    let channelId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const seedingAvailable = await isChannelSeedingAvailable(request, token)
      test.skip(
        !seedingAvailable,
        'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled in this environment; cannot seed a connected channel.',
      )

      channelId = await seedConnectedChannel(request, token, {
        displayName: `TC-CHANNEL-API-001 ${Date.now()}`,
      })

      const response = await apiRequest(
        request,
        'GET',
        `/api/communication_channels/channels/${channelId}`,
        { token },
      )
      expect(response.status(), 'GET channel detail should return 200').toBe(200)

      const body = await readJsonSafe<Record<string, unknown>>(response)
      expect(body?.id, 'response id must match the seeded channel').toBe(channelId)
      expect(body?.providerKey, 'seeded channel uses the test-seed stub provider').toBe('__test_seed__')

      // The detail route exposes only a credentials *reference*, never secrets.
      expect(body, 'detail must not embed a raw credentials object').not.toHaveProperty('credentials')
      expect(body, 'detail must not embed a password').not.toHaveProperty('password')
      expect(body, 'detail must not embed a secret').not.toHaveProperty('secret')
    } finally {
      await deleteChannelIfExists(request, token, channelId)
    }
  })

  test('rejects an unauthenticated request with 401', async ({ request }) => {
    const unknownId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const response = await request.fetch(`/api/communication_channels/channels/${unknownId}`, {
      method: 'GET',
    })
    expect(response.status()).toBe(401)
  })
})
