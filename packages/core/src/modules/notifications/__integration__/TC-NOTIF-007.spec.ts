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
  deleteGeneralEntityIfExists,
  expectId,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createNotificationFixture,
  dismissNotificationIfExists,
  listNotifications,
} from '@open-mercato/core/helpers/integration/notificationsFixtures'

test.describe('TC-NOTIF-007: Notification list is scoped by tenant and user', () => {
  test('shows each tenant user only their own notification when type values overlap', async ({ request }) => {
    const stamp = Date.now()
    const password = 'Valid1!Pass'
    const type = `qa.notifications.cross.tenant.${stamp}`
    const t1Email = `qa-notif-t1-${stamp}@acme.com`
    const t2Email = `qa-notif-t2-${stamp}@acme.com`

    let superadminToken: string | null = null
    let t1Token: string | null = null
    let t2Token: string | null = null
    let t1RoleId: string | null = null
    let t1UserId: string | null = null
    let t2TenantId: string | null = null
    let t2OrgId: string | null = null
    let t2RoleId: string | null = null
    let t2UserId: string | null = null
    let t1NotificationId: string | null = null
    let t2NotificationId: string | null = null

    try {
      superadminToken = await getAuthToken(request, 'superadmin')
      const t1Scope = getTokenScope(superadminToken)

      t1RoleId = await createRoleFixture(request, superadminToken, {
        name: `qa_notif_t1_viewer_${stamp}`,
        tenantId: t1Scope.tenantId,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: t1RoleId,
        features: ['notifications.view'],
        organizations: null,
      })
      t1UserId = await createUserFixture(request, superadminToken, {
        email: t1Email,
        password,
        organizationId: t1Scope.organizationId,
        roles: [t1RoleId],
      })
      t1Token = await getAuthToken(request, t1Email, password)

      const tenantResponse = await apiRequest(request, 'POST', '/api/directory/tenants', {
        token: superadminToken,
        data: { name: `QA Notifications Tenant ${stamp}` },
      })
      expect(tenantResponse.status(), 'POST /api/directory/tenants should return 201').toBe(201)
      t2TenantId = expectId(
        (await readJsonSafe<{ id?: string }>(tenantResponse))?.id,
        'tenant create response should include id',
      )

      const orgResponse = await apiRequest(request, 'POST', '/api/directory/organizations', {
        token: superadminToken,
        data: { tenantId: t2TenantId, name: `QA Notifications Tenant Org ${stamp}` },
      })
      expect(orgResponse.status(), 'POST /api/directory/organizations should return 201').toBe(201)
      t2OrgId = expectId(
        (await readJsonSafe<{ id?: string }>(orgResponse))?.id,
        'organization create response should include id',
      )

      t2RoleId = await createRoleFixture(request, superadminToken, {
        name: `qa_notif_t2_creator_${stamp}`,
        tenantId: t2TenantId,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: t2RoleId,
        features: ['notifications.view', 'notifications.create'],
        organizations: null,
      })

      t2UserId = await createUserFixture(request, superadminToken, {
        email: t2Email,
        password,
        organizationId: t2OrgId,
        roles: [t2RoleId],
      })
      t2Token = await getAuthToken(request, t2Email, password)

      t1NotificationId = await createNotificationFixture(request, superadminToken, {
        type,
        title: `Tenant one notification ${stamp}`,
        recipientUserId: t1UserId,
      })
      t2NotificationId = await createNotificationFixture(request, t2Token, {
        type,
        title: `Tenant two notification ${stamp}`,
        recipientUserId: t2UserId,
      })

      const t1List = await listNotifications(request, t1Token, { type, pageSize: 10 })
      expect(t1List.items).toHaveLength(1)
      expect(t1List.items.map((item) => item.id)).toContain(t1NotificationId)
      expect(t1List.items.map((item) => item.id)).not.toContain(t2NotificationId)
      expect(t1List.items[0]?.title).toBe(`Tenant one notification ${stamp}`)

      const t2List = await listNotifications(request, t2Token, { type, pageSize: 10 })
      expect(t2List.items).toHaveLength(1)
      expect(t2List.items.map((item) => item.id)).toContain(t2NotificationId)
      expect(t2List.items.map((item) => item.id)).not.toContain(t1NotificationId)
      expect(t2List.items[0]?.title).toBe(`Tenant two notification ${stamp}`)
    } finally {
      await dismissNotificationIfExists(request, t1Token, t1NotificationId)
      await dismissNotificationIfExists(request, t2Token, t2NotificationId)
      await deleteUserIfExists(request, superadminToken, t1UserId)
      await deleteUserIfExists(request, superadminToken, t2UserId)
      await deleteRoleIfExists(request, superadminToken, t1RoleId)
      await deleteRoleIfExists(request, superadminToken, t2RoleId)
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/organizations', t2OrgId)
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', t2TenantId)
    }
  })
})
