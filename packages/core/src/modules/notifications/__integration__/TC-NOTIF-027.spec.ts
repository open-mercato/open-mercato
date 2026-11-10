import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createNotificationFixture,
  dismissNotificationIfExists,
  listNotifications,
} from '@open-mercato/core/helpers/integration/notificationsFixtures'

const PASSWORD = 'Valid1!Pass'

async function createNotificationInOrganization(
  request: APIRequestContext,
  token: string,
  organizationId: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequestWithSelectedOrg(request, 'POST', '/api/notifications', {
    token,
    selectedOrgId: organizationId,
    data,
  })
  expect(response.status(), 'POST /api/notifications with a selected organization should return 201').toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, 'Notification creation response should include id')
}

async function markAllAsRead(request: APIRequestContext, token: string): Promise<void> {
  const response = await apiRequest(request, 'PUT', '/api/notifications/mark-all-read', { token })
  expect(response.status(), 'PUT /api/notifications/mark-all-read should return 200').toBe(200)
}

async function listUnreadIds(request: APIRequestContext, token: string, type: string): Promise<string[]> {
  const list = await listNotifications(request, token, { type, status: 'unread', pageSize: 10 })
  return list.items.map((item) => String(item.id)).sort()
}

test.describe('TC-NOTIF-027: mark all as read covers exactly the notifications the bell shows', () => {
  test('clears tenant-wide notifications along with the selected organization', async ({ request }) => {
    const stamp = Date.now()
    const type = `qa.notif.027.selected.${stamp}`
    const email = `qa-notif-027-selected-${stamp}@acme.com`

    let superadminToken: string | null = null
    let userToken: string | null = null
    let organizationId: string | null = null
    let roleId: string | null = null
    let userId: string | null = null
    const notificationIds: string[] = []

    try {
      superadminToken = await getAuthToken(request, 'superadmin')
      const { tenantId } = getTokenScope(superadminToken)
      organizationId = await createOrganizationFixture(request, superadminToken, { name: `QA TC-NOTIF-027 A ${stamp}`, tenantId })
      roleId = await createRoleFixture(request, superadminToken, { name: `qa_notif_027_selected_${stamp}`, tenantId })
      await setRoleAclFeatures(request, superadminToken, { roleId, features: ['notifications.view'], organizations: null })
      userId = await createUserFixture(request, superadminToken, { email, password: PASSWORD, organizationId, roles: [roleId] })

      notificationIds.push(await createNotificationInOrganization(request, superadminToken, organizationId, {
        type,
        title: 'TC-NOTIF-027 organization notification',
        recipientUserId: userId,
      }))
      notificationIds.push(await createNotificationFixture(request, superadminToken, {
        type,
        title: 'TC-NOTIF-027 tenant-wide notification',
        recipientUserId: userId,
      }))

      userToken = await getAuthToken(request, email, PASSWORD)
      const visible = await listNotifications(request, userToken, { type, pageSize: 10 })
      expect(visible.items.map((item) => String(item.id)).sort()).toEqual([...notificationIds].sort())

      await markAllAsRead(request, userToken)

      expect(await listUnreadIds(request, userToken, type)).toEqual([])
    } finally {
      for (const notificationId of notificationIds) {
        await dismissNotificationIfExists(request, userToken, notificationId)
      }
      await deleteUserIfExists(request, superadminToken, userId)
      await deleteRoleIfExists(request, superadminToken, roleId)
      await deleteOrganizationIfExists(request, superadminToken, organizationId)
    }
  })

  test('leaves notifications outside the visible organizations unread when no organization is selected', async ({ request }) => {
    const stamp = Date.now()
    const type = `qa.notif.027.restricted.${stamp}`
    const email = `qa-notif-027-restricted-${stamp}@acme.com`

    let superadminToken: string | null = null
    let userToken: string | null = null
    let homeOrganizationId: string | null = null
    let visibleOrganizationId: string | null = null
    let roleId: string | null = null
    let userId: string | null = null
    let hiddenNotificationId: string | null = null
    let tenantWideNotificationId: string | null = null

    try {
      superadminToken = await getAuthToken(request, 'superadmin')
      const { tenantId } = getTokenScope(superadminToken)
      homeOrganizationId = await createOrganizationFixture(request, superadminToken, { name: `QA TC-NOTIF-027 home ${stamp}`, tenantId })
      visibleOrganizationId = await createOrganizationFixture(request, superadminToken, { name: `QA TC-NOTIF-027 visible ${stamp}`, tenantId })
      roleId = await createRoleFixture(request, superadminToken, { name: `qa_notif_027_restricted_${stamp}`, tenantId })
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: ['notifications.view'],
        organizations: [visibleOrganizationId],
      })
      userId = await createUserFixture(request, superadminToken, {
        email,
        password: PASSWORD,
        organizationId: homeOrganizationId,
        roles: [roleId],
      })

      hiddenNotificationId = await createNotificationInOrganization(request, superadminToken, homeOrganizationId, {
        type,
        title: 'TC-NOTIF-027 notification outside the visible organizations',
        recipientUserId: userId,
      })
      tenantWideNotificationId = await createNotificationFixture(request, superadminToken, {
        type,
        title: 'TC-NOTIF-027 tenant-wide notification',
        recipientUserId: userId,
      })

      userToken = await getAuthToken(request, email, PASSWORD)
      const visible = await listNotifications(request, userToken, { type, pageSize: 10 })
      expect(visible.items.map((item) => String(item.id))).toEqual([tenantWideNotificationId])

      await markAllAsRead(request, userToken)

      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: ['notifications.view'],
        organizations: [homeOrganizationId, visibleOrganizationId],
      })
      expect(await listUnreadIds(request, userToken, type)).toEqual([hiddenNotificationId])
    } finally {
      await dismissNotificationIfExists(request, userToken, hiddenNotificationId)
      await dismissNotificationIfExists(request, userToken, tenantWideNotificationId)
      await deleteUserIfExists(request, superadminToken, userId)
      await deleteRoleIfExists(request, superadminToken, roleId)
      await deleteOrganizationIfExists(request, superadminToken, visibleOrganizationId)
      await deleteOrganizationIfExists(request, superadminToken, homeOrganizationId)
    }
  })
})
