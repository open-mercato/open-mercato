import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createNotificationFixture,
  dismissNotificationIfExists,
  listNotifications,
} from '@open-mercato/core/helpers/integration/notificationsFixtures'

const ALREADY_EXECUTED_CODE = 'notification_action_already_executed'

async function put(request: APIRequestContext, token: string, id: string, path: string, data?: Record<string, unknown>) {
  return apiRequest(request, 'PUT', `/api/notifications/${encodeURIComponent(id)}/${path}`, { token, data })
}

async function executeAction(request: APIRequestContext, token: string, id: string) {
  return apiRequest(request, 'POST', `/api/notifications/${encodeURIComponent(id)}/action`, {
    token,
    data: { actionId: 'approve', payload: {} },
  })
}

async function readStatus(request: APIRequestContext, token: string, type: string, id: string): Promise<unknown> {
  const visible = await listNotifications(request, token, { type, pageSize: 20 })
  const dismissed = await listNotifications(request, token, { type, status: 'dismissed', pageSize: 20 })
  const found = [...visible.items, ...dismissed.items].find((item) => item.id === id)
  expect(found, `notification ${id} should be listed`).toBeTruthy()
  return found?.status
}

test.describe('TC-NOTIF-018: An executed action stays executed across dismiss and restore', () => {
  test('refuses to run the action again after dismiss and after dismiss + restore', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(token)
    const type = `qa.notifications.action.dismiss.${Date.now()}`
    let notificationId: string | null = null

    try {
      notificationId = await createNotificationFixture(request, token, {
        type,
        title: 'Actionable notification',
        recipientUserId: scope.userId,
        sourceEntityId: randomUUID(),
        actions: [{ id: 'approve', label: 'Approve', href: '/backend/example/{sourceEntityId}' }],
      })

      expect((await executeAction(request, token, notificationId)).status()).toBe(200)
      expect(await readStatus(request, token, type, notificationId)).toBe('actioned')

      expect((await put(request, token, notificationId, 'dismiss')).status()).toBe(200)
      expect(await readStatus(request, token, type, notificationId)).toBe('dismissed')

      const afterDismiss = await executeAction(request, token, notificationId)
      expect(afterDismiss.status(), 'action on a dismissed, already-actioned notification').toBe(409)
      expect((await readJsonSafe<{ code?: string }>(afterDismiss))?.code).toBe(ALREADY_EXECUTED_CODE)
      expect(await readStatus(request, token, type, notificationId)).toBe('dismissed')

      for (const requested of ['read', 'unread']) {
        expect((await put(request, token, notificationId, 'restore', { status: requested })).status()).toBe(200)
        expect(
          await readStatus(request, token, type, notificationId),
          `restore requesting ${requested} brings an actioned notification back as actioned`,
        ).toBe('actioned')

        const afterRestore = await executeAction(request, token, notificationId)
        expect(afterRestore.status(), 'action on a restored, already-actioned notification').toBe(409)
        expect((await readJsonSafe<{ code?: string }>(afterRestore))?.code).toBe(ALREADY_EXECUTED_CODE)

        expect((await put(request, token, notificationId, 'dismiss')).status()).toBe(200)
      }
    } finally {
      await dismissNotificationIfExists(request, token, notificationId)
    }
  })

  test('restores a dismissed notification with no executed action to the requested status and keeps it actionable', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(token)
    const type = `qa.notifications.action.restore.${Date.now()}`
    let notificationId: string | null = null

    try {
      notificationId = await createNotificationFixture(request, token, {
        type,
        title: 'Actionable notification',
        recipientUserId: scope.userId,
        sourceEntityId: randomUUID(),
        actions: [{ id: 'approve', label: 'Approve', href: '/backend/example/{sourceEntityId}' }],
      })

      expect((await put(request, token, notificationId, 'dismiss')).status()).toBe(200)
      expect((await put(request, token, notificationId, 'restore', { status: 'unread' })).status()).toBe(200)
      expect(await readStatus(request, token, type, notificationId)).toBe('unread')

      expect((await put(request, token, notificationId, 'dismiss')).status()).toBe(200)
      expect((await put(request, token, notificationId, 'restore', { status: 'read' })).status()).toBe(200)
      expect(await readStatus(request, token, type, notificationId)).toBe('read')

      expect((await executeAction(request, token, notificationId)).status()).toBe(200)
      expect(await readStatus(request, token, type, notificationId)).toBe('actioned')
    } finally {
      await dismissNotificationIfExists(request, token, notificationId)
    }
  })
})
