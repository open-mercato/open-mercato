import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createNotificationFixture,
  dismissNotificationIfExists,
} from '@open-mercato/core/helpers/integration/notificationsFixtures'

test.describe('TC-NOTIF-010: Notification action execution', () => {
  test('executes a notification action and returns result and resolved href', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(token)
    const stamp = Date.now()
    const sourceEntityId = randomUUID()
    let notificationId: string | null = null

    try {
      notificationId = await createNotificationFixture(request, token, {
        type: `qa.notifications.action.${stamp}`,
        title: 'Actionable notification',
        recipientUserId: scope.userId,
        sourceEntityId,
        actions: [
          {
            id: 'approve',
            label: 'Approve',
            href: '/backend/example/{sourceEntityId}',
          },
        ],
      })

      const response = await apiRequest(
        request,
        'POST',
        `/api/notifications/${encodeURIComponent(notificationId)}/action`,
        { token, data: { actionId: 'approve', payload: {} } },
      )
      expect(response.status(), 'POST /api/notifications/{id}/action should return 200').toBe(200)
      const body = await readJsonSafe<{ ok?: boolean; result?: unknown; href?: string }>(response)
      expect(body?.ok).toBe(true)
      expect(body).toHaveProperty('result')
      expect(body?.result).toBeNull()
      expect(body?.href).toBe(`/backend/example/${sourceEntityId}`)

      // A repeated/duplicate action must be rejected without re-running the side
      // effect — the notification is already actioned.
      const duplicate = await apiRequest(
        request,
        'POST',
        `/api/notifications/${encodeURIComponent(notificationId)}/action`,
        { token, data: { actionId: 'approve', payload: {} } },
      )
      expect(
        duplicate.status(),
        'a repeated POST /api/notifications/{id}/action should return 409',
      ).toBe(409)
      const duplicateBody = await readJsonSafe<{ ok?: boolean; error?: string }>(duplicate)
      expect(duplicateBody?.ok).not.toBe(true)
    } finally {
      await dismissNotificationIfExists(request, token, notificationId)
    }
  })
})
