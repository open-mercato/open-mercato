import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  deleteChannelIfExists,
  isChannelSeedingAvailable,
  seedConnectedChannel,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'

/**
 * TC-CHANNEL-OUTBOUND-001 — the outbound smoke test is reachable on a channel
 * whose recipients are not email addresses.
 * Source: https://github.com/open-mercato/open-mercato/issues/4976
 *
 * `POST /channels/[id]/test-send` declared `to: z.string().email()`, so on a
 * chat channel there was no request body that could reach the adapter at all:
 * omitting `to` returned 422 (`expected string, received undefined`) and passing
 * a channel snowflake returned 422 (`Invalid email address`). QA proved the
 * adapter itself was fine by replaying its REST contract by hand — the gap was
 * entirely in the route's own validation.
 *
 * The predecessor spec (`TC-CHANNEL-EMAIL-HUB-001` → "POST test-send rejects
 * invalid body with 422") could not catch this: it posts to an all-zeros channel
 * id, so it never gets far enough to have a channel type, and it accepts
 * `[401, 404, 422]`. This spec uses a **connected** channel of each flavor, so
 * the assertion is about the contract rather than about a refusal path.
 *
 * Ceiling: the stub adapter reports a successful send without network I/O, so
 * what is asserted here is that the route accepts the request, resolves the
 * recipient and reaches the adapter. That a real provider then posts the message
 * is the adapters' own contract, unit-tested per provider package.
 *
 * Driven via the env-gated test-seed fixture (`OM_ENABLE_TEST_CHANNEL_SEEDING`);
 * skips when the gate is off.
 */
type TestSendResult = {
  status?: string
  externalMessageId?: string | null
  providerError?: string | null
  error?: string
}

async function testSend(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  channelId: string,
  data: Record<string, unknown>,
) {
  const response = await apiRequest(
    request,
    'POST',
    `/api/communication_channels/channels/${channelId}/test-send`,
    { token, data },
  )
  return { response, body: await readJsonSafe<TestSendResult>(response) }
}

test.describe('TC-CHANNEL-OUTBOUND-001: test-send on a non-email channel', () => {
  test('a chat channel accepts a send with no recipient and with a native identifier', async ({
    request,
  }) => {
    test.slow()
    let token: string | null = null
    let channelId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const seedingAvailable = await isChannelSeedingAvailable(request, token)
      test.skip(
        !seedingAvailable,
        'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled in this environment; cannot connect a channel.',
      )

      const stamp = Date.now()
      channelId = await seedConnectedChannel(request, token, {
        displayName: `Outbound smoke ${stamp}`,
        providerFlavor: 'chat',
      })

      // The documented smoke test: no recipient at all, so the adapter uses the
      // default target an operator configured when connecting the channel.
      const omitted = await testSend(request, token, channelId, {
        body: `no-recipient ${stamp}`,
      })
      expect(
        omitted.response.status(),
        'test-send with no recipient should be accepted on a chat channel',
      ).toBe(200)
      expect(omitted.body?.status).toBe('sent')
      expect(omitted.body?.externalMessageId).toBeTruthy()

      // A provider-native identifier — a Discord channel snowflake — is the
      // exact input that used to be refused as "Invalid email address".
      const snowflake = await testSend(request, token, channelId, {
        to: '1534331920463433771',
        body: `snowflake ${stamp}`,
      })
      expect(
        snowflake.response.status(),
        'test-send with a provider-native recipient should be accepted on a chat channel',
      ).toBe(200)
      expect(snowflake.body?.status).toBe('sent')
    } finally {
      if (token && channelId) await deleteChannelIfExists(request, token, channelId)
    }
  })

  test('an email channel still demands an address', async ({ request }) => {
    // The other half of the contract, and the regression this change must not
    // cause: relaxing the schema must not relax the rule for mailboxes.
    test.slow()
    let token: string | null = null
    let channelId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const seedingAvailable = await isChannelSeedingAvailable(request, token)
      test.skip(
        !seedingAvailable,
        'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled in this environment; cannot connect a channel.',
      )

      const stamp = Date.now()
      channelId = await seedConnectedChannel(request, token, {
        displayName: `Outbound smoke email ${stamp}`,
        externalIdentifier: `outbound-${stamp}@test-seed.local`,
      })

      const snowflake = await testSend(request, token, channelId, {
        to: '1534331920463433771',
        body: `snowflake ${stamp}`,
      })
      expect(
        snowflake.response.status(),
        'a non-address recipient must still be rejected on an email channel',
      ).toBe(422)

      const omitted = await testSend(request, token, channelId, { body: `omitted ${stamp}` })
      expect(
        omitted.response.status(),
        'a missing recipient must still be rejected on an email channel',
      ).toBe(422)

      const valid = await testSend(request, token, channelId, {
        to: `qa-${stamp}@test-seed.local`,
        body: `valid ${stamp}`,
      })
      expect(valid.response.status(), 'a valid address must still be accepted').toBe(200)
      expect(valid.body?.status).toBe('sent')
    } finally {
      if (token && channelId) await deleteChannelIfExists(request, token, channelId)
    }
  })
})
