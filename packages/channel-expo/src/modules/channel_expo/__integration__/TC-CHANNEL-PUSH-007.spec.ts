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
 * TC-CHANNEL-PUSH-007 — the REAL Expo adapter, end-to-end, without live credentials.
 *
 * Only the `expo-server-sdk` client is faked (`OM_PUSH_FAKE_PROVIDERS`), so the adapter's token
 * validation, chunking, and `buildExpoMessage` run for real.
 */
const PROVIDER = 'expo'

test.describe('TC-CHANNEL-PUSH-007: real Expo adapter reaches sent with a correct native message', () => {
  test('maps sound and priority onto the Expo message', async ({ request }) => {
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
      channelId = await connectFakePushChannel(request, adminToken, PROVIDER, 'TC-CHANNEL-PUSH-007 Expo')
      userDeviceId = await registerFakePushDevice(
        request,
        adminToken,
        PROVIDER,
        pushToken,
        `qa-tc-channel-push-007-${Date.now()}`,
      )

      await createNotificationFixture(request, adminToken, {
          recipientUserId: userId,
          type: 'admin.custom_message',
          title: 'Order shipped',
          body: 'Your order is on its way',
          data: { probe: 'tc-channel-push-007' },
          pushOptions: { sound: 'chime.caf', priority: 'high', channelId: 'orders' },
        })

      await drainIntegrationQueue('events')
      await drainIntegrationQueue('push-deliveries')

      await expect
        .poll(async () => (await readLatestDelivery(tenantId, userDeviceId as string))?.status ?? null, {
          timeout: 30_000,
        })
        .toBe('sent')

      const row = await readLatestDelivery(tenantId, userDeviceId as string)
      expect(row?.provider).toBe(PROVIDER)
      expect(row?.token_snapshot).toBe(tokenTail)

      const native = await expectNativeMessage(PROVIDER, tokenTail, startedAt)
      expect(native.to).toBe(pushToken)
      expect(native.title).toBe('Order shipped')
      expect(native.body).toBe('Your order is on its way')
      expect(native.sound).toBe('chime.caf')
      expect(native.priority).toBe('high')
      expect(native.channelId).toBe('orders')
    } finally {
      await deleteDeliveriesForDevice(userDeviceId)
      await deleteFakePushDevice(request, adminToken, userDeviceId)
      await deleteChannelIfExists(request, adminToken, channelId)
    }
  })
})
