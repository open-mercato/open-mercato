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
 * TC-PUSH-006 — a silent notification type delivers a data-only wake-up.
 *
 * Silent-ness is a property of the registered notification *type*, never a per-call flag: the strategy
 * derives it at fan-out, snapshots it onto the delivery row, and the adapter branches on it. This
 * asserts the full chain through the REAL FCM adapter — the built message must carry no user-facing
 * copy, only `content-available`.
 */
const PROVIDER = 'fcm'

test.describe('TC-PUSH-006: silent type → data-only content-available push', () => {
  test('omits user-facing copy and snapshots silent onto the delivery row', async ({ request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, userId } = getTokenScope(adminToken)
    const { pushToken, tokenTail } = makeFakePushToken(PROVIDER)
    const startedAt = new Date().toISOString()

    let channelId: string | null = null
    let userDeviceId: string | null = null
    try {
      channelId = await connectFakePushChannel(request, adminToken, PROVIDER, 'TC-PUSH-006 FCM')
      userDeviceId = await registerFakePushDevice(
        request,
        adminToken,
        PROVIDER,
        pushToken,
        `qa-tc-push-006-${Date.now()}`,
      )

      await createNotificationFixture(request, adminToken, {
          recipientUserId: userId,
          type: 'admin.custom_silent',
          title: 'Never rendered as a banner',
          body: 'Never rendered as a banner',
          data: { sync: 'orders', cursor: '42' },
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

      const native = await expectNativeMessage(PROVIDER, tokenTail, startedAt)
      // Data-only: a `notification` block would surface a visible banner.
      expect(native.notification).toBeUndefined()
      expect(native.data).toMatchObject({ sync: 'orders', cursor: '42' })
      expect(native.apns).toMatchObject({
        headers: { 'apns-push-type': 'background', 'apns-priority': '5' },
        payload: { aps: { 'content-available': 1 } },
      })
      expect(native.android).toMatchObject({ priority: 'high' })
    } finally {
      await deleteDeliveriesForDevice(userDeviceId)
      await deleteFakePushDevice(request, adminToken, userDeviceId)
      await deleteChannelIfExists(request, adminToken, channelId)
    }
  })
})
