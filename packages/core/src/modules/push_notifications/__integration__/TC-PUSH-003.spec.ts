import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { withClient } from '@open-mercato/core/modules/core/__integration__/helpers/dbFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'

// End-to-end coverage for the REAL push delivery pipeline: create a notification via
// `POST /api/notifications` → the persistent `notifications:deliver` subscriber runs the `push`
// delivery strategy → a `push_notification_deliveries` row is inserted `pending` and a job enqueued
// → the `send-push` worker resolves the `push_stub` channel adapter and sends → the row reaches
// `sent`. Unlike the in-process unit suites (which mock the adapter / `em.find`), this exercises the
// full route → strategy → worker → sendMessage chain against the real DB.
//
// The one real e2e blocker found during validation (see
// `.ai/specs/2026-07-01-push-delivery-e2e-findings.md`, Finding 1) was that notifications created via
// `POST /api/notifications` carried no organization, while devices, push channels, and their
// encryption maps are all org-scoped — so an org-scoped device never matched and push was silently
// dropped. The fix stamps the creator's org onto the notification in `resolveNotificationContext`.
// This test locks that contract in at the integration layer: it registers an org-scoped device and
// asserts the resulting delivery row carries the creator's organization (org propagation), so a
// regression that reverts to tenant-level (org=null) notifications would leave the device unmatched,
// no delivery row would ever be produced, and the `sent` poll below would time out.
//
// The network-free `push_stub` channel adapter (gated by `OM_ENABLE_PUSH_STUB_ADAPTER`, wired on in
// the ephemeral harness env) makes the send deterministic without a real FCM/APNs/Expo provider: a
// token containing neither `fail` nor `unregistered` resolves to `sent`.

const STUB_PROVIDER = 'push_stub'
const NOTIFICATIONS_PATH = '/api/notifications'
const DEVICES_PATH = '/api/devices'
const DELIVERIES_PATH = '/api/push_notifications/deliveries'
// The plaintext tail the delivery row must snapshot (last 8 chars). The full token is never persisted.
const TOKEN_TAIL = 'ABCDEF12'

type RegisterDeviceResponse = { id: string; deviceId: string; revived: boolean }
type CreateNotificationResponse = { id?: string }
type DeliveryRow = {
  status: string
  token_snapshot: string
  organization_id: string | null
  provider: string
  sent_at: string | null
}

async function seedPushStubChannel(tenantId: string): Promise<string> {
  return withClient(async (client) => {
    // Tenant-level (`user_id IS NULL`) push channel for the stub provider. The fan-out only requires an
    // active push channel whose `provider_key` matches the device's `push_provider`; leaving
    // `credentials_ref` NULL means the worker skips credential resolution (the stub needs none).
    const res = await client.query(
      `insert into communication_channels
         (provider_key, channel_type, display_name, is_active, status, tenant_id, organization_id, created_at, updated_at)
       values ($1, 'push', 'TC-PUSH-003 Push Stub', true, 'connected', $2, null, now(), now())
       returning id`,
      [STUB_PROVIDER, tenantId],
    )
    return res.rows[0].id as string
  })
}

async function deletePushStubChannel(id: string | null): Promise<void> {
  if (!id) return
  await withClient(async (client) => {
    await client.query('delete from communication_channels where id = $1', [id])
  }).catch(() => undefined)
}

async function deleteDeliveriesForDevice(userDeviceId: string | null): Promise<void> {
  if (!userDeviceId) return
  await withClient(async (client) => {
    await client.query('delete from push_notification_deliveries where user_device_id = $1', [userDeviceId])
  }).catch(() => undefined)
}

async function readLatestDelivery(tenantId: string, userDeviceId: string): Promise<DeliveryRow | null> {
  return withClient(async (client) => {
    const res = await client.query(
      `select status, token_snapshot, organization_id, provider, sent_at
         from push_notification_deliveries
        where tenant_id = $1 and user_device_id = $2
        order by created_at desc
        limit 1`,
      [tenantId, userDeviceId],
    )
    return (res.rows[0] as DeliveryRow | undefined) ?? null
  })
}

test.describe('TC-PUSH-003: Real push delivery pipeline (org propagation → sent)', () => {
  test('a created notification drives the worker to a sent delivery with the plaintext token snapshot', async ({
    request,
  }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, organizationId, userId } = getTokenScope(adminToken)

    let channelId: string | null = null
    let userDeviceId: string | null = null
    try {
      channelId = await seedPushStubChannel(tenantId)

      // Register an org-scoped device for the admin that routes to the stub. The token tail is what the
      // delivery row must snapshot in plaintext once the org-scoped encryption map decrypts it on read.
      const registerRes = await apiRequest(request, 'POST', DEVICES_PATH, {
        token: adminToken,
        data: {
          deviceId: `qa-tc-push-003-${Date.now()}`,
          platform: 'android',
          pushToken: `qa-push-stub-token-${TOKEN_TAIL}`,
          pushProvider: STUB_PROVIDER,
        },
      })
      expect(registerRes.status()).toBe(201)
      const registered = await readJsonSafe<RegisterDeviceResponse>(registerRes)
      userDeviceId = registered?.id ?? null
      expect(userDeviceId).toBeTruthy()

      // Self-notify: creator == recipient, so the notification inherits the admin's org (via
      // `resolveNotificationContext`) and the org-scoped device lookup matches. `admin.custom_message`
      // is `nonOptOut`, so push is delivered regardless of preference state.
      const createRes = await apiRequest(request, 'POST', NOTIFICATIONS_PATH, {
        token: adminToken,
        data: {
          recipientUserId: userId,
          type: 'admin.custom_message',
          title: 'TC-PUSH-003 real pipeline',
          body: 'Driven through the send-push worker.',
          data: { probe: 'tc-push-003' },
        },
      })
      expect(createRes.status()).toBe(201)
      const created = await readJsonSafe<CreateNotificationResponse>(createRes)
      expect(created?.id).toBeTruthy()

      // Drive the pipeline deterministically: the `events` drain runs the persistent
      // `notifications:deliver` subscriber (→ strategy → inserts the pending row + enqueues the push
      // job); the `push-deliveries` drain runs `processPushDeliveryJob` (→ stub → sent). Both the
      // fan-out INSERT and the worker claim are idempotent, so draining is safe even if the app
      // server's in-process worker already processed the job inline.
      await drainIntegrationQueue('events')
      await drainIntegrationQueue('push-deliveries')

      await expect
        .poll(async () => (await readLatestDelivery(tenantId, userDeviceId as string))?.status ?? null, {
          timeout: 30_000,
        })
        .toBe('sent')

      const row = await readLatestDelivery(tenantId, userDeviceId as string)
      expect(row).toBeTruthy()
      expect(row?.provider).toBe(STUB_PROVIDER)
      // Only the last-8 plaintext tail is persisted — never the full provider token.
      expect(row?.token_snapshot).toBe(TOKEN_TAIL)
      expect(row?.sent_at).toBeTruthy()
      // Org propagation: the delivery carries the creator's organization. If org propagation regressed
      // to tenant-level (null), the org-scoped device would never have matched and the poll above would
      // have timed out before reaching this assertion.
      expect(row?.organization_id).toBe(organizationId ?? null)
    } finally {
      await deleteDeliveriesForDevice(userDeviceId)
      if (userDeviceId) {
        await apiRequest(request, 'DELETE', `${DEVICES_PATH}/${userDeviceId}`, { token: adminToken }).catch(
          () => undefined,
        )
      }
      await deletePushStubChannel(channelId)
    }
  })
})
