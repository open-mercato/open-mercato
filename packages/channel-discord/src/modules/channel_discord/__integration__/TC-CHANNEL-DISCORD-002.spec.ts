import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-CHANNEL-DISCORD-002 — outbound test-send routing for a Discord channel.
 * Source: .ai/specs/2026-06-19-discord-communication-channel-integration.md
 *
 * The hub owns the outbound entry point (`POST /channels/[id]/test-send`); the
 * provider only supplies `convertOutbound` + `sendMessage`. This spec pins the
 * route's tenant-safety contract, which is what a provider PR can break: an
 * unauthenticated caller, a malformed id, and an id the caller does not own are
 * all refused BEFORE any adapter is resolved — so no Discord REST call can be
 * driven by an unauthorized request.
 *
 * The actual Discord payload conversion and REST post are unit-tested against a
 * stubbed client in `lib/__tests__/convert-outbound.test.ts` and
 * `lib/__tests__/adapter.test.ts`; they need a live bot token and are therefore
 * out of scope for CI.
 */
const UNKNOWN_CHANNEL_ID = '00000000-0000-4000-8000-0000000d1c02'

test.describe('TC-CHANNEL-DISCORD-002: outbound test-send guards', () => {
  test('requires authentication', async ({ request }) => {
    const response = await apiRequest(
      request,
      'POST',
      `/api/communication_channels/channels/${UNKNOWN_CHANNEL_ID}/test-send`,
      // Intentionally empty token — this assertion is the 401 unauth path.
      { token: '', data: { to: 'integration@example.com' } },
    )
    expect(response.status(), 'test-send must reject an unauthenticated caller').toBe(401)
  })

  test('rejects a malformed channel id before touching any adapter', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/channels/not-a-uuid/test-send',
      { token, data: { to: 'integration@example.com' } },
    )
    expect(response.status(), 'a non-uuid channel id must be a 400, not a 500').toBe(400)
  })

  test('rejects a channel the caller does not own', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(
      request,
      'POST',
      `/api/communication_channels/channels/${UNKNOWN_CHANNEL_ID}/test-send`,
      { token, data: { to: 'integration@example.com' } },
    )
    expect(
      response.status(),
      'an unknown/foreign channel id must be 404 — never a send attempt',
    ).toBe(404)
  })
})
