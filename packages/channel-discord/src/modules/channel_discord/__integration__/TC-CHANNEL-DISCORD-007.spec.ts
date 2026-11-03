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
 * TC-CHANNEL-DISCORD-007 — health surface for a channel carrying Discord traffic.
 * Source: .ai/specs/2026-06-19-discord-communication-channel-integration.md
 *
 * Operators diagnose a Discord channel through the hub's health route, so this
 * spec pins that surface: it is tenant-scoped (401 unauthenticated, 400 on a
 * malformed id, 404 for a channel the caller does not own) and it reports a
 * fixed numeric shape that includes Discord-provider links.
 *
 * The provider's own probe (`channelDiscordHealthCheck`: healthy on a valid bot
 * token, unhealthy on Discord's 401) calls the Discord API and is unit-tested
 * against a stubbed REST client in `lib/__tests__/adapter.test.ts`.
 */
const UNKNOWN_CHANNEL_ID = '00000000-0000-4000-8000-0000000d1c07'

test.describe('TC-CHANNEL-DISCORD-007: channel health surface', () => {
  test('requires authentication', async ({ request }) => {
    const response = await apiRequest(
      request,
      'GET',
      `/api/communication_channels/channels/${UNKNOWN_CHANNEL_ID}/health`,
      // Intentionally empty token — this assertion is the 401 unauth path.
      { token: '' },
    )
    expect(response.status(), 'health must reject an unauthenticated caller').toBe(401)
  })

  test('rejects a malformed channel id', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(
      request,
      'GET',
      '/api/communication_channels/channels/not-a-uuid/health',
      { token },
    )
    expect(response.status(), 'a non-uuid channel id must be a 400, not a 500').toBe(400)
  })

  test('rejects a channel the caller does not own', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(
      request,
      'GET',
      `/api/communication_channels/channels/${UNKNOWN_CHANNEL_ID}/health`,
      { token },
    )
    expect(response.status(), 'an unknown/foreign channel must be 404').toBe(404)
  })

  test('reports a numeric delivery snapshot that includes discord traffic', async ({ request }) => {
    test.slow()
    let token: string | null = null
    let channelId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const seedingAvailable = await isChannelSeedingAvailable(request, token)
      test.skip(
        !seedingAvailable,
        'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled in this environment; cannot seed a channel.',
      )

      const stamp = Date.now()
      channelId = await seedConnectedChannel(request, token, {
        displayName: `TC-CHANNEL-DISCORD-007 ${stamp}`,
        externalIdentifier: `discord-007-${stamp}@test-seed.local`,
      })
      await seedInboundMessage(request, token, {
        channelId,
        providerKey: 'discord',
        from: `discord-user-${stamp}`,
        subject: `Discord health seed ${stamp}`,
        bodyText: 'seed message for the health window',
        messageId: `discord-message-007-${stamp}`,
      })

      const response = await apiRequest(
        request,
        'GET',
        `/api/communication_channels/channels/${channelId}/health`,
        { token },
      )
      expect(response.status(), 'GET /channels/[id]/health should return 200').toBe(200)
      const body = await readJsonSafe<{
        channelId?: string
        windowHours?: number
        counts?: Record<string, number>
        totalsLast24h?: number
        recentFailures?: unknown[]
      }>(response)

      expect(body?.channelId, 'health must be scoped to the requested channel').toBe(channelId)
      expect(typeof body?.windowHours, 'the health window must be reported').toBe('number')
      expect(
        Object.keys(body?.counts ?? {}),
        'the delivery-status breakdown must keep its fixed shape',
      ).toEqual(expect.arrayContaining(['sent', 'delivered', 'failed', 'pending', 'queued']))
      for (const [status, value] of Object.entries(body?.counts ?? {})) {
        expect(typeof value, `counts.${status} must be numeric`).toBe('number')
      }
      expect(
        body?.totalsLast24h ?? 0,
        'the seeded discord message must be inside the 24h window',
      ).toBeGreaterThanOrEqual(1)
      expect(Array.isArray(body?.recentFailures), 'recentFailures must always be an array').toBe(true)
    } finally {
      await deleteChannelIfExists(request, token, channelId)
    }
  })
})
