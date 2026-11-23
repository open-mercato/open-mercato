import { expect, test } from '@playwright/test'
import { createQueue } from '@open-mercato/queue'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createNotificationFixture } from '@open-mercato/core/helpers/integration/notificationsFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import {
  connectFakePushChannel,
  deleteChannelIfExists,
  deleteDeliveriesForDevice,
  deleteFakePushDevice,
  isDeviceSoftDeleted,
  makeFakePushToken,
  makeFakePushTokenFor,
  readLatestDelivery,
  registerFakePushDevice,
  resolveQueueBaseDir,
} from '@open-mercato/core/helpers/integration/pushFake'

/**
 * TC-PUSH-010 — a stale Expo receipt never prunes a device that re-registered a fresh token.
 *
 * The async receipt is polled 15–60 minutes after the send. If the app re-registers the same device id
 * with a new token in that window, the receipt still reports `DeviceNotRegistered` for the OLD token.
 * The reaper must record that on the delivery row but keep the device, which now holds a working token.
 * TC-PUSH-008 covers the matching-token case, where the device is pruned.
 */
const PROVIDER = 'expo'
const RECLAIM_QUEUE = 'push-stuck-reclaim'

async function enqueueReclaimTick(tenantId: string): Promise<void> {
  const queue = createQueue<{ tenantId: string }>(RECLAIM_QUEUE, 'local', { baseDir: resolveQueueBaseDir() })
  try {
    await queue.enqueue({ tenantId })
  } finally {
    await queue.close()
  }
}

test.describe('TC-PUSH-010: stale Expo receipt does not prune a device that re-registered a fresh token', () => {
  test('the device survives the receipt sweep while the delivery row records the dead token', async ({ request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, userId } = getTokenScope(adminToken)
    const deadToken = makeFakePushTokenFor(PROVIDER, 'unregistered')
    const freshToken = makeFakePushToken(PROVIDER)
    const deviceId = `qa-tc-push-010-${Date.now()}`

    let channelId: string | null = null
    let userDeviceId: string | null = null
    try {
      channelId = await connectFakePushChannel(request, adminToken, PROVIDER, 'TC-PUSH-010 Expo')
      userDeviceId = await registerFakePushDevice(request, adminToken, PROVIDER, deadToken.pushToken, deviceId)

      await createNotificationFixture(request, adminToken, {
        recipientUserId: userId,
        type: 'admin.custom_message',
        title: 'TC-PUSH-010',
        body: 'Sent to the token that is about to be replaced.',
      })

      await drainIntegrationQueue('events')
      await drainIntegrationQueue('push-deliveries')

      await expect
        .poll(async () => (await readLatestDelivery(tenantId, userDeviceId as string))?.status ?? null, {
          timeout: 30_000,
        })
        .toBe('sent')
      expect((await readLatestDelivery(tenantId, userDeviceId as string))?.token_snapshot).toBe(deadToken.tokenTail)

      const reRegisteredId = await registerFakePushDevice(request, adminToken, PROVIDER, freshToken.pushToken, deviceId)
      expect(reRegisteredId).toBe(userDeviceId)

      await enqueueReclaimTick(tenantId)
      await drainIntegrationQueue(RECLAIM_QUEUE)

      await expect
        .poll(async () => (await readLatestDelivery(tenantId, userDeviceId as string))?.last_error ?? null, {
          timeout: 30_000,
        })
        .toBe('device_unregistered')
      const row = await readLatestDelivery(tenantId, userDeviceId as string)
      expect(row?.status).toBe('sent')
      expect(row?.provider_response?.receiptChecked).toBe(true)
      expect(await isDeviceSoftDeleted(userDeviceId as string)).toBe(false)
    } finally {
      await deleteDeliveriesForDevice(userDeviceId)
      await deleteFakePushDevice(request, adminToken, userDeviceId)
      await deleteChannelIfExists(request, adminToken, channelId)
    }
  })
})
