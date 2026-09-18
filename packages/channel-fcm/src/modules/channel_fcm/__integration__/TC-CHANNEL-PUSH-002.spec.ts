import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-CHANNEL-PUSH-002 — tenant-wide connect route for push providers.
 *
 * Push providers (FCM/APNs/Expo) declare `channelScope: 'tenant'` so their channel
 * is created once per tenant with `user_id = NULL` and serves every user's devices.
 * They connect through the dedicated admin route
 * `POST /api/communication_channels/channels/connect/tenant-credentials`
 * (feature `communication_channels.connect_tenant_channel`), NOT the per-user route.
 *
 * These assertions are network-free and self-contained: with empty/invalid input the
 * flow never creates a channel or credential row, so there is nothing to clean up.
 * The read side (fan-out + delivery) is already user-agnostic — it resolves a push
 * channel by `{ tenantId, channelType: 'push' }` with no `user_id` filter and reads
 * credentials at `channel.userId ?? null` — which is what makes one tenant channel
 * serve the whole tenant; that path is covered network-free by
 * `push_notifications/lib/__tests__/push-delivery.test.ts`.
 */
test.describe('TC-CHANNEL-PUSH-002: tenant-wide push connect route', () => {
  test('reaches the registered FCM adapter and rejects missing credentials (422)', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/channels/connect/tenant-credentials',
      {
        token,
        // Missing serviceAccountJson → the adapter's validateCredentials rejects it,
        // so the flow never creates a tenant channel (no side effect / no cleanup).
        data: { providerKey: 'fcm', displayName: 'FCM — tenant connect', credentials: {} },
      },
    )
    expect(response.status(), 'route should not 5xx').toBeLessThan(500)
    // 422 proves: authenticated, the caller HAS connect_tenant_channel, the provider
    // is tenant-scoped (else 400), and the registered FCM adapter's validateCredentials
    // ran and rejected the empty credentials.
    expect(response.status()).toBe(422)
    const body = await readJsonSafe<{ error?: string; fieldErrors?: Record<string, string> }>(response)
    expect(body?.fieldErrors ?? body?.error).toBeTruthy()
  })

  test('rejects a per-user provider on the tenant route (400)', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/channels/connect/tenant-credentials',
      {
        token,
        // IMAP is a per-user provider (no channelScope) — an admin must not be able
        // to force it into a shared tenant-wide channel through this route.
        data: { providerKey: 'imap', displayName: 'IMAP — should be rejected', credentials: {} },
      },
    )
    expect(response.status(), 'route should not 5xx').toBeLessThan(500)
    expect(response.status()).toBe(400)
    const body = await readJsonSafe<{ code?: string }>(response)
    expect(body?.code).toBe('provider_not_tenant_scoped')
  })
})
