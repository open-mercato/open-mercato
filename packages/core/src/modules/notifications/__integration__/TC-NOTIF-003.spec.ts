import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'
import {
  dismissNotificationsByType,
  listNotifications,
} from '@open-mercato/core/modules/core/__integration__/helpers/notificationsFixtures'

test.describe('TC-NOTIF-003: Notification bulk targeting APIs', () => {
  test('should create batch, role-targeted, and feature-targeted notifications', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const scope = getTokenScope(superadminToken)

    const roleName = `qa_notif_role_${Date.now()}`
    const userEmail = `qa-notif-${Date.now()}@acme.com`
    const userPassword = 'Valid1!Pass'

    let roleId: string | null = null
    let userId: string | null = null
    let recipientToken: string | null = null
    let batchType: string | null = null
    let roleType: string | null = null
    let featureType: string | null = null

    try {
      roleId = await createRoleFixture(request, superadminToken, {
        name: roleName,
        tenantId: scope.tenantId,
      })
      userId = await createUserFixture(request, superadminToken, {
        email: userEmail,
        password: userPassword,
        organizationId: scope.organizationId,
        roles: [roleName],
      })

      recipientToken = await getAuthToken(request, userEmail, userPassword)

      batchType = `qa.notifications.batch.${Date.now()}`
      const batchResponse = await apiRequest(request, 'POST', '/api/notifications/batch', {
        token: superadminToken,
        data: {
          type: batchType,
          title: 'Batch notification',
          recipientUserIds: [userId],
        },
      })
      expect(batchResponse.status()).toBe(201)
      const batchBody = await readJsonSafe<{ count?: number; ids?: string[] }>(batchResponse)
      expect(batchBody?.count).toBe(1)
      expect(batchBody?.ids).toHaveLength(1)

      const batchNotifications = await listNotifications(request, recipientToken, { type: batchType })
      expect(batchNotifications.items.some((item) => item.type === batchType)).toBe(true)

      roleType = `qa.notifications.role.${Date.now()}`
      const roleResponse = await apiRequest(request, 'POST', '/api/notifications/role', {
        token: superadminToken,
        data: {
          type: roleType,
          title: 'Role notification',
          roleId,
        },
      })
      expect(roleResponse.status()).toBe(201)
      const roleBody = await readJsonSafe<{ count?: number; ids?: string[] }>(roleResponse)
      expect((roleBody?.count ?? 0) >= 1).toBe(true)
      expect((roleBody?.ids ?? []).length).toBe(roleBody?.count ?? 0)

      const roleNotifications = await listNotifications(request, recipientToken, { type: roleType })
      expect(roleNotifications.items.some((item) => item.type === roleType)).toBe(true)

      featureType = `qa.notifications.feature.${Date.now()}`
      const featureResponse = await apiRequest(request, 'POST', '/api/notifications/feature', {
        token: superadminToken,
        data: {
          type: featureType,
          title: 'Feature notification',
          requiredFeature: 'auth.users.list',
        },
      })
      expect(featureResponse.status()).toBe(201)
      const featureBody = await readJsonSafe<{ count?: number; ids?: string[] }>(featureResponse)
      expect((featureBody?.count ?? 0) >= 1).toBe(true)
      expect((featureBody?.ids ?? []).length).toBe(featureBody?.count ?? 0)

      const adminNotifications = await listNotifications(request, adminToken, { type: featureType })
      expect(adminNotifications.items.some((item) => item.type === featureType)).toBe(true)
    } finally {
      await dismissNotificationsByType(request, adminToken, featureType)
      await dismissNotificationsByType(request, superadminToken, featureType)
      await dismissNotificationsByType(request, recipientToken, roleType)
      await dismissNotificationsByType(request, recipientToken, batchType)
      await deleteUserIfExists(request, superadminToken, userId)
      await deleteRoleIfExists(request, superadminToken, roleId)
    }
  })
})
