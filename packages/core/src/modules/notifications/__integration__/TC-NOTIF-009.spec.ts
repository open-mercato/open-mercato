import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  getTokenScope,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createNotificationFixture,
  dismissNotificationIfExists,
  listNotifications,
} from '@open-mercato/core/helpers/integration/notificationsFixtures'
import { expectJsonError } from './helpers/notificationsApi'

test.describe('TC-NOTIF-009: Users cannot access other users notifications', () => {
  test('hides and rejects read, dismiss, and action attempts for another user notification', async ({ request }) => {
    const stamp = Date.now()
    const password = 'Valid1!Pass'
    const userOneEmail = `qa-notif-owner-${stamp}@acme.com`
    const userTwoEmail = `qa-notif-other-${stamp}@acme.com`
    const type = `qa.notifications.cross.user.${stamp}`
    const sourceEntityId = randomUUID()

    let superadminToken: string | null = null
    let userOneToken: string | null = null
    let userTwoToken: string | null = null
    let roleId: string | null = null
    let userOneId: string | null = null
    let userTwoId: string | null = null
    let notificationId: string | null = null

    try {
      superadminToken = await getAuthToken(request, 'superadmin')
      const scope = getTokenScope(superadminToken)
      roleId = await createRoleFixture(request, superadminToken, {
        name: `qa_notif_cross_user_viewer_${stamp}`,
        tenantId: scope.tenantId,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: ['notifications.view'],
        organizations: null,
      })
      userOneId = await createUserFixture(request, superadminToken, {
        email: userOneEmail,
        password,
        organizationId: scope.organizationId,
        roles: [roleId],
      })
      userTwoId = await createUserFixture(request, superadminToken, {
        email: userTwoEmail,
        password,
        organizationId: scope.organizationId,
        roles: [roleId],
      })
      userOneToken = await getAuthToken(request, userOneEmail, password)
      userTwoToken = await getAuthToken(request, userTwoEmail, password)

      notificationId = await createNotificationFixture(request, superadminToken, {
        type,
        title: 'Notification for another user',
        recipientUserId: userOneId,
        sourceEntityId,
        actions: [
          {
            id: 'approve',
            label: 'Approve',
            href: '/backend/example/{sourceEntityId}',
          },
        ],
      })

      const otherUserList = await listNotifications(request, userTwoToken, { type, pageSize: 10 })
      expect(otherUserList.items.some((item) => item.id === notificationId)).toBe(false)
      expect(otherUserList.items.length).toBe(0)

      const readResponse = await apiRequest(
        request,
        'PUT',
        `/api/notifications/${encodeURIComponent(notificationId)}/read`,
        { token: userTwoToken },
      )
      await expectJsonError(readResponse, 404, 'other user read attempt should not find notification')

      const dismissResponse = await apiRequest(
        request,
        'PUT',
        `/api/notifications/${encodeURIComponent(notificationId)}/dismiss`,
        { token: userTwoToken },
      )
      await expectJsonError(dismissResponse, 404, 'other user dismiss attempt should not find notification')

      const actionResponse = await apiRequest(
        request,
        'POST',
        `/api/notifications/${encodeURIComponent(notificationId)}/action`,
        { token: userTwoToken, data: { actionId: 'approve', payload: {} } },
      )
      await expectJsonError(actionResponse, 404, 'other user action attempt should not find notification')
    } finally {
      await dismissNotificationIfExists(request, userOneToken, notificationId)
      await deleteUserIfExists(request, superadminToken, userOneId)
      await deleteUserIfExists(request, superadminToken, userTwoId)
      await deleteRoleIfExists(request, superadminToken, roleId)
    }
  })
})
