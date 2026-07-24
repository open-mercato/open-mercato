import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  apiRequestWithSelectedOrg,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createOrganizationInDb,
  deleteOrganizationInDb,
} from '@open-mercato/core/helpers/integration/dbFixtures'
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

async function createNotificationInScope(
  request: APIRequestContext,
  token: string,
  selectedOrgId: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequestWithSelectedOrg(request, 'POST', '/api/notifications', {
    token,
    selectedOrgId,
    data,
  })
  expect(response.status(), 'POST /api/notifications should return 201').toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, 'notification create response should include id')
}

async function getNotificationsInScope(
  request: APIRequestContext,
  token: string,
  selectedOrgId: string,
  type: string,
): Promise<Array<Record<string, unknown>>> {
  const response = await apiRequestWithSelectedOrg(
    request,
    'GET',
    `/api/notifications?type=${encodeURIComponent(type)}&pageSize=10`,
    { token, selectedOrgId },
  )
  expect(response.ok(), 'GET /api/notifications should succeed').toBeTruthy()
  const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(response)
  return body?.items ?? []
}

async function getUnreadCountInScope(
  request: APIRequestContext,
  token: string,
  selectedOrgId: string,
): Promise<number> {
  const response = await apiRequestWithSelectedOrg(
    request,
    'GET',
    '/api/notifications/unread-count',
    { token, selectedOrgId },
  )
  expect(response.ok(), 'GET /api/notifications/unread-count should succeed').toBeTruthy()
  const body = await readJsonSafe<{ unreadCount?: number }>(response)
  return body?.unreadCount ?? 0
}

async function getUnreadListCountInScope(
  request: APIRequestContext,
  token: string,
  selectedOrgId: string,
): Promise<number> {
  const response = await apiRequestWithSelectedOrg(
    request,
    'GET',
    '/api/notifications?status=unread&pageSize=100',
    { token, selectedOrgId },
  )
  expect(response.ok(), 'GET /api/notifications unread list should succeed').toBeTruthy()
  const body = await readJsonSafe<{ total?: number }>(response)
  return body?.total ?? 0
}

async function dismissNotificationInScope(
  request: APIRequestContext,
  token: string | null,
  selectedOrgId: string | null,
  notificationId: string | null,
): Promise<void> {
  if (!token || !selectedOrgId || !notificationId) return
  await apiRequestWithSelectedOrg(
    request,
    'PUT',
    `/api/notifications/${encodeURIComponent(notificationId)}/dismiss`,
    { token, selectedOrgId },
  ).catch(() => undefined)
}

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

  test('scopes list and unread count to the selected organization while retaining tenant-wide notifications', async ({ request }) => {
    const stamp = Date.now()
    const password = 'Valid1!Pass'
    const email = `qa-notif-org-scope-${stamp}@acme.com`
    const type = `qa.notifications.organization.scope.${stamp}`
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(superadminToken)
    const homeOrgId = expectId(scope.organizationId, 'superadmin token should include an organization id')

    let siblingOrgId: string | null = null
    let roleId: string | null = null
    let userId: string | null = null
    let userToken: string | null = null
    let homeNotificationId: string | null = null
    let siblingNotificationId: string | null = null
    let tenantWideNotificationId: string | null = null

    try {
      siblingOrgId = await createOrganizationInDb({
        name: `QA Notifications Sibling Org ${stamp}`,
        tenantId: scope.tenantId,
      })

      roleId = await createRoleFixture(request, superadminToken, {
        name: `qa_notif_org_scope_${stamp}`,
        tenantId: scope.tenantId,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: ['notifications.view', 'notifications.create'],
        organizations: null,
      })
      userId = await createUserFixture(request, superadminToken, {
        email,
        password,
        organizationId: homeOrgId,
        roles: [roleId],
      })
      userToken = await getAuthToken(request, email, password)

      const homeUnreadBaseline = await getUnreadListCountInScope(request, userToken, homeOrgId)
      const siblingUnreadBaseline = await getUnreadListCountInScope(request, userToken, siblingOrgId)
      const allUnreadBaseline = await getUnreadListCountInScope(request, userToken, '__all__')

      homeNotificationId = await createNotificationInScope(request, userToken, homeOrgId, {
        type,
        title: `Home organization notification ${stamp}`,
        recipientUserId: userId,
      })
      siblingNotificationId = await createNotificationInScope(request, userToken, siblingOrgId, {
        type,
        title: `Sibling organization notification ${stamp}`,
        recipientUserId: userId,
      })
      tenantWideNotificationId = await createNotificationInScope(request, userToken, '__all__', {
        type,
        title: `Tenant-wide notification ${stamp}`,
        recipientUserId: userId,
      })

      const homeItems = await getNotificationsInScope(request, userToken, homeOrgId, type)
      expect(homeItems.map((item) => item.id)).toEqual(expect.arrayContaining([
        homeNotificationId,
        tenantWideNotificationId,
      ]))
      expect(homeItems.map((item) => item.id)).not.toContain(siblingNotificationId)

      const siblingItems = await getNotificationsInScope(request, userToken, siblingOrgId, type)
      expect(siblingItems.map((item) => item.id)).toEqual(expect.arrayContaining([
        siblingNotificationId,
        tenantWideNotificationId,
      ]))
      expect(siblingItems.map((item) => item.id)).not.toContain(homeNotificationId)

      const allItems = await getNotificationsInScope(request, userToken, '__all__', type)
      expect(allItems.map((item) => item.id)).toEqual(expect.arrayContaining([
        homeNotificationId,
        siblingNotificationId,
        tenantWideNotificationId,
      ]))
      expect(await getUnreadCountInScope(request, userToken, homeOrgId)).toBe(homeUnreadBaseline + 2)
      expect(await getUnreadCountInScope(request, userToken, siblingOrgId)).toBe(siblingUnreadBaseline + 2)
      expect(await getUnreadCountInScope(request, userToken, '__all__')).toBe(allUnreadBaseline + 3)
    } finally {
      await dismissNotificationInScope(request, userToken, homeOrgId, homeNotificationId)
      await dismissNotificationInScope(request, userToken, siblingOrgId, siblingNotificationId)
      await dismissNotificationInScope(request, userToken, '__all__', tenantWideNotificationId)
      await deleteUserIfExists(request, superadminToken, userId)
      await deleteRoleIfExists(request, superadminToken, roleId)
      await deleteOrganizationInDb(siblingOrgId)
    }
  })
})
