import { test } from '@playwright/test'
import { expectJsonError, rawApiRequest } from './helpers/notificationsApi'

const UNKNOWN_NOTIFICATION_ID = '00000000-0000-4000-8000-000000000004'

test.describe('TC-NOTIF-004: Notification APIs require authentication', () => {
  test('returns 401 with an error body for anonymous notification requests', async ({ request }) => {
    const cases = [
      {
        method: 'GET',
        path: '/api/notifications',
        label: 'GET /api/notifications without auth',
      },
      {
        method: 'POST',
        path: '/api/notifications',
        data: {
          type: 'qa.notifications.unauthenticated',
          title: 'Anonymous notification attempt',
          recipientUserId: UNKNOWN_NOTIFICATION_ID,
        },
        label: 'POST /api/notifications without auth',
      },
      {
        method: 'GET',
        path: '/api/notifications/unread-count',
        label: 'GET /api/notifications/unread-count without auth',
      },
      {
        method: 'PUT',
        path: '/api/notifications/mark-all-read',
        label: 'PUT /api/notifications/mark-all-read without auth',
      },
      {
        method: 'PUT',
        path: `/api/notifications/${UNKNOWN_NOTIFICATION_ID}/read`,
        label: 'PUT /api/notifications/{id}/read without auth',
      },
    ]

    for (const entry of cases) {
      const response = await rawApiRequest(request, entry.method, entry.path, { data: entry.data })
      await expectJsonError(response, 401, entry.label)
    }
  })
})
