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
} from '@open-mercato/core/helpers/integration/notificationsFixtures'

const PASSWORD = 'Valid1!Pass'

type UserSession = { token: string; selectedOrgId?: string }

function sendAsUser(request: APIRequestContext, method: string, path: string, session: UserSession) {
  return session.selectedOrgId
    ? apiRequestWithSelectedOrg(request, method, path, { token: session.token, selectedOrgId: session.selectedOrgId })
    : apiRequest(request, method, path, { token: session.token })
}

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

async function listNotificationIds(
  request: APIRequestContext,
  session: UserSession,
  query: Record<string, string>,
): Promise<string[]> {
  const params = new URLSearchParams({ ...query, pageSize: '10' })
  const response = await sendAsUser(request, 'GET', `/api/notifications?${params.toString()}`, session)
  expect(response.status(), 'GET /api/notifications should return 200').toBe(200)
  const body = await readJsonSafe<{ items?: Array<{ id?: string }> }>(response)
  return (body?.items ?? []).map((item) => String(item.id)).sort((left, right) => left.localeCompare(right))
}

async function markAllAsRead(request: APIRequestContext, session: UserSession): Promise<void> {
  const response = await sendAsUser(request, 'PUT', '/api/notifications/mark-all-read', session)
  expect(response.status(), 'PUT /api/notifications/mark-all-read should return 200').toBe(200)
}

async function readUnreadCount(request: APIRequestContext, session: UserSession): Promise<number | undefined> {
  const response = await sendAsUser(request, 'GET', '/api/notifications/unread-count', session)
  expect(response.status(), 'GET /api/notifications/unread-count should return 200').toBe(200)
  const body = await readJsonSafe<{ unreadCount?: number }>(response)
  return body?.unreadCount
}

test.describe('TC-NOTIF-027: mark all as read covers exactly the notifications the bell shows', () => {
  test('clears child-organization and tenant-wide notifications when a parent organization is selected', async ({ request }) => {
    const stamp = Date.now()
    const type = `qa.notif.027.selected.${stamp}`
    const email = `qa-notif-027-selected-${stamp}@acme.com`

    let superadminToken: string | null = null
    let userToken: string | null = null
    let parentOrganizationId: string | null = null
    let childOrganizationId: string | null = null
    let roleId: string | null = null
    let userId: string | null = null
    const notificationIds: string[] = []

    try {
      superadminToken = await getAuthToken(request, 'superadmin')
      const { tenantId } = getTokenScope(superadminToken)
      parentOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-NOTIF-027 parent ${stamp}`,
        tenantId,
      })
      childOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-NOTIF-027 child ${stamp}`,
        tenantId,
        parentId: parentOrganizationId,
      })
      roleId = await createRoleFixture(request, superadminToken, { name: `qa_notif_027_selected_${stamp}`, tenantId })
      await setRoleAclFeatures(request, superadminToken, { roleId, features: ['notifications.view'], organizations: null })
      userId = await createUserFixture(request, superadminToken, {
        email,
        password: PASSWORD,
        organizationId: childOrganizationId,
        roles: [roleId],
      })

      notificationIds.push(await createNotificationInOrganization(request, superadminToken, childOrganizationId, {
        type,
        title: 'TC-NOTIF-027 child organization notification',
        recipientUserId: userId,
      }))
      notificationIds.push(await createNotificationFixture(request, superadminToken, {
        type,
        title: 'TC-NOTIF-027 tenant-wide notification',
        recipientUserId: userId,
      }))

      userToken = await getAuthToken(request, email, PASSWORD)
      const session: UserSession = { token: userToken, selectedOrgId: parentOrganizationId }
      expect(await listNotificationIds(request, session, { type }))
        .toEqual([...notificationIds].sort((left, right) => left.localeCompare(right)))

      await markAllAsRead(request, session)

      expect(await listNotificationIds(request, session, { type, status: 'unread' })).toEqual([])
      expect(await readUnreadCount(request, session)).toBe(0)
    } finally {
      for (const notificationId of notificationIds) {
        await dismissNotificationIfExists(request, userToken, notificationId)
      }
      await deleteUserIfExists(request, superadminToken, userId)
      await deleteRoleIfExists(request, superadminToken, roleId)
      await deleteOrganizationIfExists(request, superadminToken, childOrganizationId)
      await deleteOrganizationIfExists(request, superadminToken, parentOrganizationId)
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
      const session: UserSession = { token: userToken }
      expect(await listNotificationIds(request, session, { type })).toEqual([tenantWideNotificationId])

      await markAllAsRead(request, session)

      expect(await readUnreadCount(request, session)).toBe(0)
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: ['notifications.view'],
        organizations: [homeOrganizationId, visibleOrganizationId],
      })
      expect(await listNotificationIds(request, session, { type, status: 'unread' })).toEqual([hiddenNotificationId])
    } finally {
      if (superadminToken && roleId && homeOrganizationId && visibleOrganizationId) {
        await setRoleAclFeatures(request, superadminToken, {
          roleId,
          features: ['notifications.view'],
          organizations: [homeOrganizationId, visibleOrganizationId],
        }).catch(() => undefined)
      }
      await dismissNotificationIfExists(request, userToken, hiddenNotificationId)
      await dismissNotificationIfExists(request, userToken, tenantWideNotificationId)
      await deleteUserIfExists(request, superadminToken, userId)
      await deleteRoleIfExists(request, superadminToken, roleId)
      await deleteOrganizationIfExists(request, superadminToken, visibleOrganizationId)
      await deleteOrganizationIfExists(request, superadminToken, homeOrganizationId)
    }
  })
})
