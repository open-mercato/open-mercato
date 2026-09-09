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
  makeFakePushTokenFor,
  readLatestDelivery,
  registerFakePushDevice,
  resolveQueueBaseDir,
} from '@open-mercato/core/helpers/integration/pushFake'

/**
 * TC-PUSH-008 — Expo's ASYNC receipt path prunes an uninstalled device.
 *
 * Expo delivery is two-phase, and this is the only provider where the common "app uninstalled" case is
 * invisible at send time: the ticket comes back `ok`, and `DeviceNotRegistered` only surfaces later in
 * the receipt. FCM and APNs report it synchronously (TC-PUSH-004). So the delivery row legitimately
 * reaches `sent` here, and the device is soft-deleted afterwards by the receipt reaper.
 *
 * The reaper rides the `push-stuck-reclaim` scheduler tick, which does not run under Playwright — the
 * spec enqueues one itself. It also skips rows younger than `OM_PUSH_RECEIPT_MIN_AGE_MINUTES`
 * (defaulted to 0 by the integration harness; 15 minutes in production).
 */
const PROVIDER = 'expo'
const RECLAIM_QUEUE = 'push-stuck-reclaim'

async function enqueueReclaimTick(tenantId: string): Promise<void> {
  // Resolve through the shared helper rather than a local fallback: the harness may point
  // `QUEUE_BASE_DIR` somewhere other than `<appRoot>/.mercato/queue` (the ephemeral runner does), and the
  // drain child honors it. A hand-rolled path would enqueue into a queue nobody drains.
  const queue = createQueue<{ tenantId: string }>(RECLAIM_QUEUE, 'local', { baseDir: resolveQueueBaseDir() })
  try {
    await queue.enqueue({ tenantId })
  } finally {
    await queue.close()
  }
}

test.describe('TC-PUSH-008: Expo async receipt reports DeviceNotRegistered → device pruned', () => {
  test('a sent delivery is later pruned when its receipt reports the device is gone', async ({ request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, userId } = getTokenScope(adminToken)
    const { pushToken } = makeFakePushTokenFor(PROVIDER, 'unregistered')

    let channelId: string | null = null
    let userDeviceId: string | null = null
    try {
      channelId = await connectFakePushChannel(request, adminToken, PROVIDER, 'TC-PUSH-008 Expo')
      // `unregistered` in the token makes the fake return an ACCEPTED ticket whose receipt later
      // reports `DeviceNotRegistered` — Expo's real two-phase behavior for an uninstalled app.
      userDeviceId = await registerFakePushDevice(
        request,
        adminToken,
        PROVIDER,
        pushToken,
        `qa-tc-push-008-${Date.now()}`,
      )

      await createNotificationFixture(request, adminToken, {
          recipientUserId: userId,
          type: 'admin.custom_message',
          title: 'TC-PUSH-008',
          body: 'Drives the Expo receipt branch.',
        })

      await drainIntegrationQueue('events')
      await drainIntegrationQueue('push-deliveries')

      // The send itself succeeds: Expo accepted the message, so nothing yet says the token is dead.
      await expect
        .poll(async () => (await readLatestDelivery(tenantId, userDeviceId as string))?.status ?? null, {
          timeout: 30_000,
        })
        .toBe('sent')
      expect(await isDeviceSoftDeleted(userDeviceId as string)).toBe(false)

      await enqueueReclaimTick(tenantId)
      await drainIntegrationQueue(RECLAIM_QUEUE)

      // The receipt sweep is what discovers the dead token and prunes the device.
      await expect.poll(() => isDeviceSoftDeleted(userDeviceId as string), { timeout: 30_000 }).toBe(true)

      const row = await readLatestDelivery(tenantId, userDeviceId as string)
      expect(row?.last_error).toBe('device_unregistered')
      // The delivery stays `sent` — the send really did succeed; only the receipt failed later.
      expect(row?.status).toBe('sent')
    } finally {
      await deleteDeliveriesForDevice(userDeviceId)
      await deleteFakePushDevice(request, adminToken, userDeviceId)
      await deleteChannelIfExists(request, adminToken, channelId)
    }
  })
})
