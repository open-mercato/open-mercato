import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createUserFixture, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import {
  deleteChannelIfExists,
  isChannelSeedingAvailable,
  seedConnectedChannel,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'

/**
 * TC-CHANNEL-DISCORD-011 — the AI auto-reply panel lists the Discord channels
 * operators actually have.
 * Source: https://github.com/open-mercato/open-mercato/issues/5602
 *
 * The panel on `/backend/integrations/channel_discord` is the ONLY entry point
 * to the per-channel AI auto-reply settings — no row action on the channels
 * list, no menu item — so an empty panel is an unreachable feature, not a
 * cosmetic gap. It filtered `userId: null` on the assumption that a Discord bot
 * channel is tenant-scoped. Nothing the product exposes can create such a
 * channel: the connect widget posts to the per-user credentials route, which
 * writes `user_id = auth.sub`, and the tenant-wide route refuses Discord
 * outright because the adapter declares no `channelScope`. So the filter matched
 * nothing that can exist, and `GET /api/channel_discord/ai-auto-reply/channels`
 * returned `{"items":[]}` on a tenant with working Discord bots.
 *
 * The two halves this pins, because fixing one by breaking the other is the easy
 * mistake here:
 *   1. a per-user Discord channel — the only kind there is — appears for its
 *      owner;
 *   2. it does NOT appear for anybody else, not even another admin. Personal
 *      channel privacy is strict owner-only (v1), and widening a listing must
 *      not be a way around it.
 *
 * Ceiling, stated rather than implied: a REAL Discord channel cannot be
 * connected in CI, because the adapter's `validateCredentials` performs a live
 * call against a bot token no test environment has. The fixture therefore
 * connects the network-free chat stub and relabels its `provider_key`. What that
 * does NOT stub is the thing that was broken — the row is a genuine
 * `communication_channels` row with a genuine `user_id`, produced by the real
 * connect command, and the route under test is the real one.
 *
 * Driven via the env-gated test-seed fixture (`OM_ENABLE_TEST_CHANNEL_SEEDING`);
 * skips when the gate is off.
 */
const PANEL_PATH = '/api/channel_discord/ai-auto-reply/channels'

type PanelItem = {
  channelId?: string
  displayName?: string
  aiAutoReplyEnabled?: boolean
  aiAgentId?: string | null
}

async function readPanel(
  request: Parameters<typeof apiRequest>[0],
  token: string,
): Promise<PanelItem[]> {
  const response = await apiRequest(request, 'GET', PANEL_PATH, { token })
  expect(response.status(), `GET ${PANEL_PATH} should return 200`).toBe(200)
  const body = await readJsonSafe<{ items?: PanelItem[] }>(response)
  return body?.items ?? []
}

test.describe('TC-CHANNEL-DISCORD-011: the AI auto-reply panel listing', () => {
  test('lists the caller’s own Discord channel and hides another operator’s', async ({
    request,
  }) => {
    test.slow()
    let token: string | null = null
    let otherToken: string | null = null
    let channelId: string | null = null
    let otherChannelId: string | null = null
    let otherUserId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      const seedingAvailable = await isChannelSeedingAvailable(request, token)
      test.skip(
        !seedingAvailable,
        'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled in this environment; cannot connect a channel.',
      )

      const stamp = Date.now()
      const { organizationId } = getTokenContext(token)

      // `providerFlavor: 'chat'` gives the row the shape a real Discord channel
      // has (no email-ish credential, so `external_identifier` stays NULL); the
      // relabel is what makes the provider-scoped route see it at all.
      const displayName = `TC-CHANNEL-DISCORD-011 ${stamp}`
      channelId = await seedConnectedChannel(request, token, {
        displayName,
        providerFlavor: 'chat',
        labelAsProviderKey: 'discord',
      })

      const items = await readPanel(request, token)
      const listed = items.find((item) => item.channelId === channelId)

      expect(
        listed,
        'A connected Discord channel must appear in the panel that configures it — ' +
          'the panel is the only way into the AI auto-reply settings (#5602)',
      ).toBeTruthy()
      expect(listed?.displayName).toBe(displayName)
      // Default OFF, and the panel reports it rather than omitting the row.
      expect(listed?.aiAutoReplyEnabled).toBe(false)
      expect(listed?.aiAgentId).toBeNull()

      // A second operator, in the same admin role, with the same
      // `channel_discord.view` grant. Personal channels are owner-only in v1, so
      // no feature grant may reveal one — widening the listing must not have
      // opened that door.
      const otherEmail = `tc-discord-011-${stamp}@integration.test`
      otherUserId = await createUserFixture(request, token, {
        email: otherEmail,
        password: 'secret123',
        organizationId,
        roles: ['admin'],
        name: `TC-CHANNEL-DISCORD-011 peer ${stamp}`,
      })
      otherToken = await getAuthToken(request, otherEmail, 'secret123')

      otherChannelId = await seedConnectedChannel(request, otherToken, {
        displayName: `TC-CHANNEL-DISCORD-011 peer ${stamp}`,
        providerFlavor: 'chat',
        labelAsProviderKey: 'discord',
      })

      const ownerItems = await readPanel(request, token)
      expect(
        ownerItems.map((item) => item.channelId),
        'Another operator’s personal Discord channel must stay invisible, admin grant or not',
      ).not.toContain(otherChannelId)

      const peerItems = await readPanel(request, otherToken)
      expect(peerItems.map((item) => item.channelId)).toContain(otherChannelId)
      expect(peerItems.map((item) => item.channelId)).not.toContain(channelId)
    } finally {
      await deleteChannelIfExists(request, otherToken, otherChannelId)
      await deleteChannelIfExists(request, token, channelId)
      await deleteUserIfExists(request, token, otherUserId)
    }
  })

  test('refuses a caller whose session does not resolve', async ({ request }) => {
    const response = await apiRequest(request, 'GET', PANEL_PATH, { token: 'not-a-session-token' })
    expect([401, 403]).toContain(response.status())
  })
})
