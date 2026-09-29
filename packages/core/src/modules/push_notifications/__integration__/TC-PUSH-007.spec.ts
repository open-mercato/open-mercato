import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createNotificationFixture,
  listNotifications,
} from '@open-mercato/core/helpers/integration/notificationsFixtures'
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
 * TC-PUSH-007 — `pushOptions` round-trips from the create API into the provider-native message.
 *
 * Covers the one option with cross-surface meaning: `pushOptions.body` overrides the *push* copy while
 * leaving the in-app notification body untouched. `TC-NOTIF-013` asserts the API round-trip; this
 * asserts the mapping onto the wire message built by the REAL adapter.
 */
const PROVIDER = 'fcm'
const IN_APP_BODY = 'In-app body stays as written'
const PUSH_BODY = 'Shortened push body'

test.describe('TC-PUSH-007: pushOptions round-trip into the native message', () => {
  test('body override applies to the push only, and image/badge/sound map per platform', async ({ request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, userId } = getTokenScope(adminToken)
    const { pushToken, tokenTail } = makeFakePushToken(PROVIDER)
    const startedAt = new Date().toISOString()

    let channelId: string | null = null
    let userDeviceId: string | null = null
    let notificationId: string | null = null
    try {
      channelId = await connectFakePushChannel(request, adminToken, PROVIDER, 'TC-PUSH-007 FCM')
      userDeviceId = await registerFakePushDevice(
        request,
        adminToken,
        PROVIDER,
        pushToken,
        `qa-tc-push-007-${Date.now()}`,
      )

      notificationId = await createNotificationFixture(request, adminToken, {
          recipientUserId: userId,
          type: 'admin.custom_message',
          title: 'Order shipped',
          body: IN_APP_BODY,
          pushOptions: {
            body: PUSH_BODY,
            badge: 9,
            sound: 'chime.caf',
            image: 'https://cdn.example.com/hero.png',
            priority: 'normal',
          },
        })

      await drainIntegrationQueue('events')
      await drainIntegrationQueue('push-deliveries')

      await expect
        .poll(async () => (await readLatestDelivery(tenantId, userDeviceId as string))?.status ?? null, {
          timeout: 30_000,
        })
        .toBe('sent')

      const native = await expectNativeMessage(PROVIDER, tokenTail, startedAt)
      // The push carries the override; the in-app notification body is unchanged (asserted below).
      expect(native.notification).toMatchObject({
        title: 'Order shipped',
        body: PUSH_BODY,
        imageUrl: 'https://cdn.example.com/hero.png',
      })
      expect(native.android).toMatchObject({
        priority: 'normal',
        notification: { sound: 'chime.caf', imageUrl: 'https://cdn.example.com/hero.png' },
      })
      expect(native.apns).toMatchObject({
        headers: { 'apns-priority': '5' },
        payload: { aps: { badge: 9, sound: 'chime.caf' } },
      })

      const { items } = await listNotifications(request, adminToken)
      const persisted = items.find((item) => item.id === notificationId)
      expect(persisted?.body).toBe(IN_APP_BODY)
    } finally {
      await deleteDeliveriesForDevice(userDeviceId)
      await deleteFakePushDevice(request, adminToken, userDeviceId)
      await deleteChannelIfExists(request, adminToken, channelId)
    }
  })
})
