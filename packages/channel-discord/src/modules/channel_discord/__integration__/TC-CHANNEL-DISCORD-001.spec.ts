import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-CHANNEL-DISCORD-001 — connect a Discord channel via credentials.
 * Source: .ai/specs/2026-06-19-discord-communication-channel-integration.md
 *
 * Asserts the two halves of the connect contract through the hub's real route:
 *
 *  1. The `discord` adapter IS registered with the hub — an unknown provider key
 *     resolves to no adapter and returns 404, `discord` does not.
 *  2. `validateCredentials` is fail-closed and offline — a malformed credential
 *     blob is rejected with per-field errors (422) by the zod schema BEFORE any
 *     Discord REST call, so this test needs no bot token and no network.
 *
 * The happy path (a real token accepted by `GET /users/@me`) needs live Discord
 * and stays unit-tested with a stubbed REST client in
 * `lib/__tests__/adapter.test.ts`.
 */
test.describe('TC-CHANNEL-DISCORD-001: connect channel via credentials', () => {
  test('requires authentication', async ({ request }) => {
    const response = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/channels/connect/credentials',
      // Intentionally empty token — this assertion is the 401 unauth path.
      { token: '', data: { providerKey: 'discord', displayName: 'unauth', credentials: {} } },
    )
    expect(response.status(), 'connect must reject an unauthenticated caller').toBe(401)
  })

  test('the discord adapter is registered and rejects malformed credentials with field errors', async ({
    request,
  }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()

    const unknownProvider = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/channels/connect/credentials',
      {
        token,
        data: {
          providerKey: `not-a-provider-${stamp}`,
          displayName: `TC-CHANNEL-DISCORD-001 unknown ${stamp}`,
          credentials: {},
        },
      },
    )
    expect(
      unknownProvider.status(),
      'an unregistered provider key must resolve to no adapter (404)',
    ).toBe(404)

    const discord = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/channels/connect/credentials',
      {
        token,
        data: {
          providerKey: 'discord',
          displayName: `TC-CHANNEL-DISCORD-001 ${stamp}`,
          // Missing botToken/applicationId, and a publicKey that is neither hex
          // nor 32 bytes — all three must come back as field errors.
          credentials: { publicKey: 'not-a-hex-key' },
        },
      },
    )
    expect(
      discord.status(),
      'discord IS registered, so the failure must be credential validation (422), not 404',
    ).toBe(422)

    const body = await readJsonSafe<{ error?: string; fieldErrors?: Record<string, string> }>(discord)
    expect(body?.error, 'the 422 must report credential validation').toBe('Credential validation failed')
    const fieldErrors = body?.fieldErrors ?? {}
    expect(
      Object.keys(fieldErrors),
      'every missing/invalid credential field must be reported back to the operator',
    ).toEqual(expect.arrayContaining(['botToken', 'applicationId', 'publicKey']))
  })

  test('a rejected connect attempt creates no channel', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const displayName = `TC-CHANNEL-DISCORD-001 orphan ${stamp}`

    const rejected = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/channels/connect/credentials',
      { token, data: { providerKey: 'discord', displayName, credentials: {} } },
    )
    expect(rejected.status(), 'malformed credentials must be rejected').toBe(422)

    const listed = await apiRequest(request, 'GET', '/api/communication_channels/me/channels', {
      token,
    })
    expect(listed.status(), 'GET /me/channels should return 200').toBe(200)
    const body = await readJsonSafe<{ items?: Array<{ displayName?: string }> }>(listed)
    const names = (body?.items ?? []).map((item) => item.displayName)
    expect(names, 'a failed validation must not leave a half-connected channel behind').not.toContain(
      displayName,
    )
  })
})
