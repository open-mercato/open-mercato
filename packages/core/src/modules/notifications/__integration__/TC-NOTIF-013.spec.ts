import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { getTokenScope } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createNotificationFixture,
  listNotifications,
} from '@open-mercato/core/modules/core/__integration__/helpers/notificationsFixtures'
import { withClient } from '@open-mercato/core/modules/core/__integration__/helpers/dbFixtures'

// Phase 5: visible notifications can carry an arbitrary app-readable `data` map (exposed to in-app
// clients) plus a push-only `pushOptions` map (sound/badge/priority/…). This proves the create →
// persist → DTO round-trip for both. Silent push is just a `silent: true` type going through the
// same create flow and is covered by the push_notifications unit suites (push-delivery-strategy /
// adapters).
test.describe('TC-NOTIF-013: Notification create carries data + pushOptions', () => {
  test('persists data (exposed in the DTO) and push_options (push-only)', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(token)
    const stamp = Date.now()
    const type = `qa.notifications.payload.${stamp}`
    const data = { orderId: `o-${stamp}`, deeplink: '/orders/1' }
    const pushOptions = { sound: 'chime.caf', badge: 2, priority: 'high' }
    let notificationId: string | null = null

    try {
      notificationId = await createNotificationFixture(request, token, {
        type,
        title: `Payload notification ${stamp}`,
        recipientUserId: scope.userId,
        body: 'Custom payload coverage',
        data,
        pushOptions,
      })

      // The arbitrary `data` map is exposed to in-app clients via the notification DTO.
      const list = await listNotifications(request, token, { type, status: 'unread' })
      const item = list.items.find((row) => row.id === notificationId)
      expect(item).toBeTruthy()
      expect(item?.data).toEqual(data)

      // `pushOptions` is push-only (not in the DTO) — assert it persisted on the row.
      const stored = await withClient(async (client) => {
        const res = await client.query(
          'select data, push_options from notifications where id = $1',
          [notificationId],
        )
        return res.rows[0] as { data: unknown; push_options: unknown }
      })
      expect(stored.data).toEqual(data)
      expect(stored.push_options).toEqual(pushOptions)
    } finally {
      if (notificationId) {
        await withClient(async (client) => {
          await client.query('delete from notifications where id = $1', [notificationId])
        }).catch(() => undefined)
      }
    }
  })
})
