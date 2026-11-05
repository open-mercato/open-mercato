import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createNotificationFixture,
  dismissNotificationIfExists,
  listNotifications,
} from '@open-mercato/core/helpers/integration/notificationsFixtures'

const POLL_INTERVAL_MS = 5_000
const CACHE_CONVERGENCE_TIMEOUT_MS = POLL_INTERVAL_MS * 2 + 1_000

test.describe('TC-NOTIF-011: Notification list cache convergence and isolation', () => {
  test('converges after creation within two poll ticks without sharing cached pages between users', async ({ request }) => {
    const stamp = Date.now()
    const password = 'Valid1!Pass'
    const otherUserEmail = `qa-notif-cache-other-${stamp}@acme.com`
    const type = `qa.notifications.cache.${stamp}`
    const query = { type, status: 'unread', pageSize: 10 }

    let superadminToken: string | null = null
    let otherUserToken: string | null = null
    let roleId: string | null = null
    let otherUserId: string | null = null
    let notificationId: string | null = null

    try {
      const ownerToken = await getAuthToken(request, 'superadmin')
      superadminToken = ownerToken
      const scope = getTokenScope(ownerToken)
      roleId = await createRoleFixture(request, superadminToken, {
        name: `qa_notif_cache_viewer_${stamp}`,
        tenantId: scope.tenantId,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: ['notifications.view'],
        organizations: null,
      })
      otherUserId = await createUserFixture(request, superadminToken, {
        email: otherUserEmail,
        password,
        organizationId: scope.organizationId,
        roles: [roleId],
      })
      otherUserToken = await getAuthToken(request, otherUserEmail, password)

      const initialOwnerList = await listNotifications(request, superadminToken, query)
      const initialOtherList = await listNotifications(request, otherUserToken, query)
      expect(initialOwnerList.items).toEqual([])
      expect(initialOtherList.items).toEqual([])

      const createdNotificationId = await createNotificationFixture(request, superadminToken, {
        type,
        title: 'Notification list cache convergence',
        recipientUserId: scope.userId,
      })
      notificationId = createdNotificationId

      await expect.poll(
        async () => {
          const refreshedOwnerList = await listNotifications(request, ownerToken, query)
          return refreshedOwnerList.items.some((item) => item.id === createdNotificationId)
        },
        {
          intervals: [POLL_INTERVAL_MS],
          timeout: CACHE_CONVERGENCE_TIMEOUT_MS,
        },
      ).toBe(true)

      const isolatedOtherList = await listNotifications(request, otherUserToken, query)
      expect(isolatedOtherList.items.some((item) => item.id === createdNotificationId)).toBe(false)
    } finally {
      await dismissNotificationIfExists(request, superadminToken, notificationId)
      await deleteUserIfExists(request, superadminToken, otherUserId)
      await deleteRoleIfExists(request, superadminToken, roleId)
    }
  })

  test('converges after marking a notification read within two poll ticks', async ({ request }) => {
    const stamp = Date.now()
    const type = `qa.notifications.cache.read.${stamp}`
    const query = { type, status: 'unread', pageSize: 10 }

    let superadminToken: string | null = null
    let notificationId: string | null = null

    try {
      const ownerToken = await getAuthToken(request, 'superadmin')
      superadminToken = ownerToken
      const scope = getTokenScope(ownerToken)
      const createdNotificationId = await createNotificationFixture(request, ownerToken, {
        type,
        title: 'Notification read cache convergence',
        recipientUserId: scope.userId,
      })
      notificationId = createdNotificationId

      const initialUnreadList = await listNotifications(request, ownerToken, query)
      expect(initialUnreadList.items.some((item) => item.id === createdNotificationId)).toBe(true)

      const readResponse = await apiRequest(
        request,
        'PUT',
        `/api/notifications/${encodeURIComponent(createdNotificationId)}/read`,
        { token: ownerToken },
      )
      expect(readResponse.status()).toBe(200)

      await expect.poll(
        async () => {
          const refreshedUnreadList = await listNotifications(request, ownerToken, query)
          return refreshedUnreadList.items.some((item) => item.id === createdNotificationId)
        },
        {
          intervals: [POLL_INTERVAL_MS],
          timeout: CACHE_CONVERGENCE_TIMEOUT_MS,
        },
      ).toBe(false)
    } finally {
      await dismissNotificationIfExists(request, superadminToken, notificationId)
    }
  })
})
