import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-CHANNEL-PUSH-001 — FCM is registered AND tenant-scoped, so the per-user
 * connect route refuses it.
 *
 * `@open-mercato/channel-fcm` registers the `fcm` push `ChannelAdapter` at import
 * with `channelScope: 'tenant'`. Push providers are connected tenant-wide by an
 * admin through `POST /channels/connect/tenant-credentials` (see
 * TC-CHANNEL-PUSH-002), NOT the per-user route. The per-user route
 * `POST /channels/connect/credentials` now short-circuits tenant-scoped providers
 * with 403 (`provider_is_tenant_scoped`) before touching credentials — this both
 * proves the adapter is registered (an UNregistered provider would fall through to
 * 404 `no_adapter`) and guards against a non-admin minting a tenant-wide channel.
 * No channel is created, so there is nothing to clean up.
 */
test.describe('TC-CHANNEL-PUSH-001: FCM registered + rejected on the per-user route', () => {
  test('POST per-user connect/credentials with providerKey=fcm is refused (403, tenant-scoped)', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/channels/connect/credentials',
      {
        token,
        data: { providerKey: 'fcm', displayName: 'FCM — per-user (should be refused)', credentials: {} },
      },
    )
    expect(response.status(), 'route should not 5xx').toBeLessThan(500)
    // 403 (not 404) proves the FCM adapter is registered and declares tenant scope,
    // and that the per-user route refuses it before any credential/channel work.
    expect(response.status()).toBe(403)
    const body = await readJsonSafe<{ code?: string }>(response)
    expect(body?.code).toBe('provider_is_tenant_scoped')
  })
})
