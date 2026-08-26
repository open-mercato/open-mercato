import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  deleteChannelIfExists,
  isChannelSeedingAvailable,
  seedConnectedChannel,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'

/**
 * TC-CHANNEL-EMAIL-HUB-001 — Per-user channel API contract.
 *
 * Slice 3d delivers:
 *   - GET  /api/communication_channels/me/channels
 *   - POST /api/communication_channels/channels/connect/credentials
 *   - POST /api/communication_channels/channels/[id]/set-primary
 *   - POST /api/communication_channels/channels/[id]/test-send
 *   - POST /api/communication_channels/send-as-user
 *
 * Until provider packages (slices 3e/f/g) register adapters, the positive paths
 * all return 404 (no adapter). This test verifies the routes are wired and
 * authentication / payload validation works end-to-end.
 */
test.describe('TC-CHANNEL-EMAIL-HUB-001: per-user channel API contract', () => {
  test('GET /me/channels returns paginated list shape (empty for new user)', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'GET',
      '/api/communication_channels/me/channels',
      { token },
    )
    expect(response.status()).toBeLessThan(500)
    if (response.status() === 200) {
      const body = await readJsonSafe<{ items?: unknown[]; total?: number }>(response)
      expect(Array.isArray(body?.items)).toBe(true)
      expect(typeof body?.total).toBe('number')
    }
  })

  test('POST connect/credentials with unknown provider returns 404', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/channels/connect/credentials',
      {
        token,
        data: {
          providerKey: '__nonexistent_provider__',
          displayName: 'Test',
          credentials: { username: 'x', password: 'y' },
        },
      },
    )
    expect(response.status()).toBeLessThan(500)
    expect([401, 404]).toContain(response.status())
  })

  test('POST connect/credentials rejects invalid body with 422', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/channels/connect/credentials',
      {
        token,
        data: { providerKey: '' },
      },
    )
    expect(response.status()).toBeLessThan(500)
    expect([401, 422]).toContain(response.status())
  })

  test('POST set-primary rejects malformed channel id with 400', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/channels/not-a-uuid/set-primary',
      { token },
    )
    expect(response.status()).toBeLessThan(500)
    expect([400, 401, 404]).toContain(response.status())
  })

  // `to` is no longer `z.string().email()` at the schema — the provider decides the
  // recipient shape once the adapter is resolved (#4976). So this case has to assert
  // against something the *widened* schema still rejects, or it stops testing its own
  // name: an empty `to` fails `z.string().min(1)` before any channel lookup happens.
  test('POST test-send rejects invalid body with 422', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/channels/00000000-0000-0000-0000-000000000000/test-send',
      {
        token,
        data: { to: '' },
      },
    )
    expect(response.status()).toBeLessThan(500)
    expect([401, 422]).toContain(response.status())
  })

  // The behavior change in #4976 is the *route wiring* — `test-send` calling
  // `validateOutboundRecipient` against `adapter.capabilities` after the adapter is
  // resolved. Unit tests cover the helper in isolation; only a connected channel
  // reaches the adapter-resolution path, so these two cases are what would fail if
  // someone deleted the validation block from the route.
  test('POST test-send on a connected channel rejects a non-email recipient with 422', async ({
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
        'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled in this environment; cannot seed a connected channel.',
      )

      const stamp = Date.now()
      channelId = await seedConnectedChannel(request, token, {
        displayName: `TC-CHANNEL-EMAIL-HUB-001 ${stamp}`,
        externalIdentifier: `hub-001-${stamp}@test-seed.local`,
      })

      // The stub adapter spreads `baseEmailCapabilities`, so it carries
      // `recipientFormat: 'email'` — proving the email default really does survive
      // end-to-end and not only in the helper's unit test.
      const response = await apiRequest(
        request,
        'POST',
        `/api/communication_channels/channels/${encodeURIComponent(channelId)}/test-send`,
        { token, data: { to: 'not-an-email' } },
      )
      expect(response.status(), 'an email-format channel rejects a non-address recipient').toBe(422)
      const body = await readJsonSafe<{ error?: string }>(response)
      expect(body?.error, 'the rejection comes from the recipient validator').toBe(
        'Recipient must be a valid email address',
      )
    } finally {
      await deleteChannelIfExists(request, token, channelId)
    }
  })

  // `to` became optional so a provider that carries its own outbound target can run
  // the documented smoke test without naming a recipient (#4976). That must not leak
  // into the email path: no email adapter has a default address to fall back to, so
  // an omitted recipient here has to stay a 422 rather than become a silent no-target
  // send. This is the case that would fail if the optionality were made unconditional.
  test('POST test-send on a connected email channel still requires a recipient', async ({
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
        'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled in this environment; cannot seed a connected channel.',
      )

      const stamp = Date.now()
      channelId = await seedConnectedChannel(request, token, {
        displayName: `TC-CHANNEL-EMAIL-HUB-001 no-recipient ${stamp}`,
        externalIdentifier: `hub-001-no-recipient-${stamp}@test-seed.local`,
      })

      const response = await apiRequest(
        request,
        'POST',
        `/api/communication_channels/channels/${encodeURIComponent(channelId)}/test-send`,
        { token, data: { body: 'no recipient named' } },
      )
      expect(response.status(), 'an email-format channel refuses an omitted recipient').toBe(422)
      const body = await readJsonSafe<{ error?: string }>(response)
      expect(body?.error, 'the rejection comes from the recipient validator').toBe(
        'Recipient is required',
      )
    } finally {
      await deleteChannelIfExists(request, token, channelId)
    }
  })

  test('POST test-send on a connected channel rejects a CR/LF header injection with 422', async ({
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
        'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled in this environment; cannot seed a connected channel.',
      )

      const stamp = Date.now()
      channelId = await seedConnectedChannel(request, token, {
        displayName: `TC-CHANNEL-EMAIL-HUB-001 crlf ${stamp}`,
        externalIdentifier: `hub-001-crlf-${stamp}@test-seed.local`,
      })

      // The CR/LF guard deliberately stayed at the schema level, so it fires before
      // the channel is even looked up — this confirms widening `to` did not cost the
      // endpoint its header-injection defense on the real route.
      const response = await apiRequest(
        request,
        'POST',
        `/api/communication_channels/channels/${encodeURIComponent(channelId)}/test-send`,
        { token, data: { to: 'qa@example.com\r\nBcc: attacker@example.com' } },
      )
      expect(response.status(), 'a CR/LF recipient is refused at the schema').toBe(422)
    } finally {
      await deleteChannelIfExists(request, token, channelId)
    }
  })

  test('POST send-as-user rejects missing recipients with 422', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/send-as-user',
      {
        token,
        data: {
          userChannelId: '00000000-0000-0000-0000-000000000000',
          subject: 'x',
          body: { plain: 'x' },
        },
      },
    )
    expect(response.status()).toBeLessThan(500)
    expect([401, 404, 422]).toContain(response.status())
  })
})
