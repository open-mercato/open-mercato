import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-CHANNEL-PUSH-004 — Expo is registered AND tenant-scoped.
 *
 * `@open-mercato/channel-expo` registers the `expo` push `ChannelAdapter` at import with
 * `channelScope: 'tenant'`. Push providers have no OAuth/webhook surface of their own, so
 * the credential-connect routes are where hub registration is observable:
 *
 * - the **per-user** route short-circuits tenant-scoped providers with 403
 *   (`provider_is_tenant_scoped`) before touching credentials — 403 rather than 404
 *   (`no_adapter`) proves the adapter is registered, and it guards against a non-admin
 *   minting a tenant-wide channel;
 * - the **tenant** route runs the adapter's own `validateCredentials`, which returns 422.
 *
 * Expo credentials are all-optional (`accessToken?`), so an empty object would VALIDATE
 * and create a channel on the tenant route — we send a wrong-typed `accessToken` instead,
 * so `validateCredentials` rejects it and the flow stays side-effect-free.
 */
test.describe('TC-CHANNEL-PUSH-004: Expo provider registration', () => {
  test('POST per-user connect/credentials with providerKey=expo is refused (403, tenant-scoped)', async ({
    request,
  }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/channels/connect/credentials',
      {
        token,
        data: {
          providerKey: 'expo',
          displayName: 'Expo — per-user (should be refused)',
          credentials: { accessToken: 12345 },
        },
      },
    )
    expect(response.status(), 'route should not 5xx').toBeLessThan(500)
    expect(response.status(), 'Expo provider should be registered (never 404 no_adapter)').not.toBe(404)
    expect(response.status(), 'authenticated request should not 401').not.toBe(401)
    expect(response.status()).toBe(403)
    const body = await readJsonSafe<{ code?: string }>(response)
    expect(body?.code).toBe('provider_is_tenant_scoped')
  })

  test('POST tenant connect/credentials with providerKey=expo reaches validateCredentials (422)', async ({
    request,
  }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/channels/connect/tenant-credentials',
      {
        token,
        // Wrong-typed accessToken (not an empty object, which would validate and create a
        // channel) → validateCredentials rejects it, so the flow stays side-effect-free.
        data: {
          providerKey: 'expo',
          displayName: 'Expo — tenant connect',
          credentials: { accessToken: 12345 },
        },
      },
    )
    expect(response.status(), 'route should not 5xx').toBeLessThan(500)
    // A 422 proves the request reached the registered adapter and ran its validateCredentials
    // — not just that auth short-circuited. 401 would satisfy "not 404" without proving it.
    expect(response.status(), 'authenticated request should not 401').not.toBe(401)
    expect(response.status(), 'wrong-typed credentials should reach the adapter and 422').toBe(422)
    const body = await readJsonSafe<{ error?: string; fieldErrors?: Record<string, string> }>(response)
    expect(body?.fieldErrors ?? body?.error).toBeTruthy()
  })
})
