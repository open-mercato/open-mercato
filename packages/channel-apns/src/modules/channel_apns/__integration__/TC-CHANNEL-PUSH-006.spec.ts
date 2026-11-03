import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createNotificationFixture } from '@open-mercato/core/helpers/integration/notificationsFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import {
  connectFakePushChannel,
  deleteChannelIfExists,
  deleteDeliveriesForDevice,
  deleteFakePushDevice,
  expectNativeMessage,
  makeFakePushToken,
  readLatestDelivery,
  registerFakePushDevice,
} from '@open-mercato/core/helpers/integration/pushFake'

/**
 * TC-CHANNEL-PUSH-006 — the REAL APNs adapter, end-to-end, without live credentials.
 *
 * Only the network provider is faked (`OM_PUSH_FAKE_PROVIDERS`): the adapter's credential resolution and
 * `buildApnsNotification` run for real, against a real `apn.Notification`. The `.p8` key is never parsed
 * because parsing lives inside the sender factory the fake replaces — the connect route only
 * schema-validates it.
 *
 * The recorded message is therefore the WIRE form node-apn transmits: request `headers` (where
 * `apns-push-type` lives) and the compiled `aps` payload.
 */
const PROVIDER = 'apns'

type NativeApns = {
  headers: Record<string, unknown>
  payload: { aps: Record<string, unknown> } & Record<string, unknown>
}

test.describe('TC-CHANNEL-PUSH-006: real APNs adapter reaches sent with a correct native notification', () => {
  test('maps pushOptions onto the aps payload for a visible notification', async ({ request }) => {
    // Budgeted explicitly rather than via `test.slow()` (which only triples the config's 20s budget).
    // NOTE: this does not fix the current CI failure — `POST /api/notifications` hangs >30s in the
    // channel-package shard, so the test dies on `apiRequest`'s own 30s timeout. See the spec changelog.
    test.setTimeout(120_000)
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, userId } = getTokenScope(adminToken)
    const { pushToken, tokenTail } = makeFakePushToken(PROVIDER)
    const startedAt = new Date().toISOString()

    let channelId: string | null = null
    let userDeviceId: string | null = null
    try {
      channelId = await connectFakePushChannel(request, adminToken, PROVIDER, 'TC-CHANNEL-PUSH-006 APNs')
      userDeviceId = await registerFakePushDevice(
        request,
        adminToken,
        PROVIDER,
        pushToken,
        `qa-tc-channel-push-006-${Date.now()}`,
      )

      await createNotificationFixture(request, adminToken, {
          recipientUserId: userId,
          type: 'admin.custom_message',
          title: 'Order shipped',
          body: 'Your order is on its way',
          pushOptions: { badge: 5, sound: 'chime.caf' },
        })

      await drainIntegrationQueue('events')
      await drainIntegrationQueue('push-deliveries')

      await expect
        .poll(async () => (await readLatestDelivery(tenantId, userDeviceId as string))?.status ?? null, {
          timeout: 30_000,
        })
        .toBe('sent')

      const native = (await expectNativeMessage(PROVIDER, tokenTail, startedAt)) as unknown as NativeApns
      expect(native.headers['apns-topic']).toBe('com.openmercato.fake')
      expect(native.payload.aps).toMatchObject({
        alert: { title: 'Order shipped', body: 'Your order is on its way' },
        badge: 5,
        sound: 'chime.caf',
      })
      expect(native.payload.aps['content-available']).toBeUndefined()
    } finally {
      await deleteDeliveriesForDevice(userDeviceId)
      await deleteFakePushDevice(request, adminToken, userDeviceId)
      await deleteChannelIfExists(request, adminToken, channelId)
    }
  })

  test('a silent type produces a background content-available push with no user-facing copy', async ({ request }) => {
    // Budgeted explicitly rather than via `test.slow()` (which only triples the config's 20s budget).
    // NOTE: this does not fix the current CI failure — `POST /api/notifications` hangs >30s in the
    // channel-package shard, so the test dies on `apiRequest`'s own 30s timeout. See the spec changelog.
    test.setTimeout(120_000)
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, userId } = getTokenScope(adminToken)
    const { pushToken, tokenTail } = makeFakePushToken(PROVIDER)
    const startedAt = new Date().toISOString()

    let channelId: string | null = null
    let userDeviceId: string | null = null
    try {
      channelId = await connectFakePushChannel(request, adminToken, PROVIDER, 'TC-CHANNEL-PUSH-006 APNs silent')
      userDeviceId = await registerFakePushDevice(
        request,
        adminToken,
        PROVIDER,
        pushToken,
        `qa-tc-channel-push-006-silent-${Date.now()}`,
      )

      // Silent-ness is a property of the registered type, never a per-call flag.
      await createNotificationFixture(request, adminToken, {
          recipientUserId: userId,
          type: 'admin.custom_silent',
          title: 'Should not be delivered as copy',
          body: 'Should not be delivered as copy',
          data: { sync: 'orders' },
        })

      await drainIntegrationQueue('events')
      await drainIntegrationQueue('push-deliveries')

      await expect
        .poll(async () => (await readLatestDelivery(tenantId, userDeviceId as string))?.status ?? null, {
          timeout: 30_000,
        })
        .toBe('sent')

      const row = await readLatestDelivery(tenantId, userDeviceId as string)
      expect(row?.silent).toBe(true)

      const native = (await expectNativeMessage(PROVIDER, tokenTail, startedAt)) as unknown as NativeApns
      // Apple requires both of these for a background push; sending an alert alongside them is invalid.
      expect(native.headers['apns-push-type']).toBe('background')
      expect(native.headers['apns-priority']).toBe(5)
      expect(native.payload.aps).toEqual({ 'content-available': 1 })
      expect(native.payload.sync).toBe('orders')
    } finally {
      await deleteDeliveriesForDevice(userDeviceId)
      await deleteFakePushDevice(request, adminToken, userDeviceId)
      await deleteChannelIfExists(request, adminToken, channelId)
    }
  })
})
