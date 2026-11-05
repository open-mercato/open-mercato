import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createNotificationFixture,
  dismissNotificationIfExists,
  listNotifications,
} from '@open-mercato/core/modules/core/__integration__/helpers/notificationsFixtures'

test.describe('TC-NOTIF-001: Notification inbox lifecycle APIs', () => {
  test('should list, read, dismiss, restore, and mark notifications as read', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(token)
    const type = `qa.notifications.lifecycle.${Date.now()}`
    const title = `Lifecycle notification ${Date.now()}`
    let notificationId: string | null = null

    try {
      notificationId = await createNotificationFixture(request, token, {
        type,
        title,
        recipientUserId: scope.userId,
        severity: 'info',
        body: 'Lifecycle coverage notification',
      })

      const unreadList = await listNotifications(request, token, { type, status: 'unread' })
      const unreadItem = unreadList.items.find((item) => item.id === notificationId)
      expect(unreadItem).toBeTruthy()

      const readResponse = await apiRequest(
        request,
        'PUT',
        `/api/notifications/${encodeURIComponent(notificationId)}/read`,
        { token },
      )
      expect(readResponse.status()).toBe(200)

      const readList = await listNotifications(request, token, { type, status: 'read' })
      expect(readList.items.some((item) => item.id === notificationId)).toBe(true)

      const dismissResponse = await apiRequest(
        request,
        'PUT',
        `/api/notifications/${encodeURIComponent(notificationId)}/dismiss`,
        { token },
      )
      expect(dismissResponse.status()).toBe(200)

      const defaultList = await listNotifications(request, token, { type })
      expect(defaultList.items.some((item) => item.id === notificationId)).toBe(false)

      const restoreResponse = await apiRequest(
        request,
        'PUT',
        `/api/notifications/${encodeURIComponent(notificationId)}/restore`,
        { token, data: { status: 'unread' } },
      )
      expect(restoreResponse.status()).toBe(200)

      const restoredUnread = await listNotifications(request, token, { type, status: 'unread' })
      expect(restoredUnread.items.some((item) => item.id === notificationId)).toBe(true)

      const markAllReadResponse = await apiRequest(request, 'PUT', '/api/notifications/mark-all-read', {
        token,
      })
      expect(markAllReadResponse.status()).toBe(200)
      const markAllReadBody = await readJsonSafe<{ ok?: boolean; count?: number }>(markAllReadResponse)
      expect(markAllReadBody?.ok).toBe(true)
      expect(typeof markAllReadBody?.count).toBe('number')

      const unreadCountResponse = await apiRequest(request, 'GET', '/api/notifications/unread-count', { token })
      expect(unreadCountResponse.status()).toBe(200)
      const unreadCountBody = await readJsonSafe<{ unreadCount?: number }>(unreadCountResponse)
      expect(typeof unreadCountBody?.unreadCount).toBe('number')

      const finalReadList = await listNotifications(request, token, { type, status: 'read' })
      expect(finalReadList.items.some((item) => item.id === notificationId)).toBe(true)
    } finally {
      await dismissNotificationIfExists(request, token, notificationId)
    }
  })
})
