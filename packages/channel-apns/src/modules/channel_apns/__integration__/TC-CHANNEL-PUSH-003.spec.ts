import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-CHANNEL-PUSH-003 — APNs is registered AND tenant-scoped.
 *
 * `@open-mercato/channel-apns` registers the `apns` push `ChannelAdapter` at import
 * with `channelScope: 'tenant'`. Push providers have no OAuth/webhook surface of their
 * own, so the credential-connect routes are where hub registration is observable:
 *
 * - the **per-user** route short-circuits tenant-scoped providers with 403
 *   (`provider_is_tenant_scoped`) before touching credentials — 403 rather than 404
 *   (`no_adapter`) proves the adapter is registered, and it guards against a non-admin
 *   minting a tenant-wide channel;
 * - the **tenant** route runs the adapter's own `validateCredentials`, which rejects the
 *   empty payload with 422 — proving the adapter is not merely registered but reachable.
 *
 * Neither call creates a channel, so there is nothing to clean up. Real send paths are
 * covered network-free by `lib/__tests__/adapter.test.ts`.
 */
test.describe('TC-CHANNEL-PUSH-003: APNs provider registration', () => {
  test('POST per-user connect/credentials with providerKey=apns is refused (403, tenant-scoped)', async ({
    request,
  }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/channels/connect/credentials',
      {
        token,
        data: { providerKey: 'apns', displayName: 'APNs — per-user (should be refused)', credentials: {} },
      },
    )
    expect(response.status(), 'route should not 5xx').toBeLessThan(500)
    expect(response.status(), 'authenticated request should not 401').not.toBe(401)
    expect(response.status()).toBe(403)
    const body = await readJsonSafe<{ code?: string }>(response)
    expect(body?.code).toBe('provider_is_tenant_scoped')
  })

  test('POST tenant connect/credentials with providerKey=apns reaches validateCredentials (422)', async ({
    request,
  }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/channels/connect/tenant-credentials',
      {
        token,
        // Missing p8Key/keyId/teamId/bundleId → validateCredentials rejects it, so the
        // flow never creates a channel (no side effect / no cleanup needed).
        data: { providerKey: 'apns', displayName: 'APNs — tenant connect', credentials: {} },
      },
    )
    expect(response.status(), 'route should not 5xx').toBeLessThan(500)
    // Asserting 422 (not merely "not 404") proves the request authenticated AND reached the
    // adapter — a 401 auth misconfig would otherwise let the spec pass vacuously.
    expect(response.status(), 'authenticated request should not 401').not.toBe(401)
    expect(response.status(), 'registered adapter should reject empty credentials with 422').toBe(422)
    const body = await readJsonSafe<{ error?: string; fieldErrors?: Record<string, string> }>(response)
    expect(body?.fieldErrors ?? body?.error).toBeTruthy()
  })
})
