import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  dismissNotificationIfExists,
  listNotifications,
} from '@open-mercato/core/helpers/integration/notificationsFixtures'
import {
  createStaffTeamMemberFixture,
  deleteStaffEntityIfExists,
} from '@open-mercato/core/helpers/integration/staffFixtures'

/**
 * TC-NOTIF-019: notification actions keep the target command's authorization boundary (#7215)
 *
 * Covers:
 * - POST /api/notifications (and the shared bulk handler) refuses an action carrying a `commandId`:
 *   a role holding `notifications.create` but not `wms.manage_locations` cannot plant a
 *   `wms.locations.delete` button, and the location survives.
 * - POST /api/notifications/:id/action refuses a declared command action when the clicking user no
 *   longer holds the action's `requiredFeatures` (403 `notification_action_forbidden`), and the leave
 *   request stays pending; with the feature restored the same action approves it.
 * - The bell panel shows the translated refusal instead of silently doing nothing.
 */

const COMMAND_NOT_ALLOWED_CODE = 'notification_action_command_not_allowed'
const ACTION_FORBIDDEN_CODE = 'notification_action_forbidden'
const PENDING_TYPE = 'staff.leave_request.pending'
const LEAVE_REQUESTS_PATH = '/api/staff/leave-requests'
const MEMBERS_PATH = '/api/staff/team-members'
const PASSWORD = 'StrongSecret123!'
const BASE_FEATURES = ['notifications.view', 'notifications.create']
const LEAVE_MANAGE_FEATURE = 'staff.leave_requests.manage'

type Actor = { roleId: string; userId: string; email: string; token: string }

async function createActor(
  request: APIRequestContext,
  superadminToken: string,
  organizationId: string,
  tenantId: string,
  label: string,
  features: string[],
): Promise<Actor> {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const email = `qa-tc-notif-019-${label}-${stamp}@example.com`
  const roleId = await createRoleFixture(request, superadminToken, { name: `qa-tc-notif-019-${label}-${stamp}`, tenantId })
  await setRoleAclFeatures(request, superadminToken, { roleId, features, organizations: null })
  const userId = await createUserFixture(request, superadminToken, {
    email,
    password: PASSWORD,
    organizationId,
    roles: [roleId],
    name: `QA TC-NOTIF-019 ${label}`,
  })
  const token = await getAuthToken(request, email, PASSWORD)
  return { roleId, userId, email, token }
}

async function createPendingLeaveRequest(
  request: APIRequestContext,
  adminToken: string,
  memberId: string,
): Promise<string> {
  const offsetDays = 60 + Math.floor(Math.random() * 300)
  const startDate = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000).toISOString()
  const endDate = new Date(Date.now() + (offsetDays + 2) * 24 * 60 * 60 * 1000).toISOString()
  const response = await apiRequest(request, 'POST', LEAVE_REQUESTS_PATH, {
    token: adminToken,
    data: { memberId, startDate, endDate, timezone: 'UTC' },
  })
  expect(response.status(), 'POST /api/staff/leave-requests should return 201').toBe(201)
  const id = (await readJsonSafe<{ id?: string }>(response))?.id
  expect(id, 'leave request create should return an id').toBeTruthy()
  return id!
}

async function readLeaveStatus(request: APIRequestContext, adminToken: string, id: string): Promise<unknown> {
  const response = await apiRequest(request, 'GET', `${LEAVE_REQUESTS_PATH}?ids=${encodeURIComponent(id)}`, { token: adminToken })
  expect(response.status(), 'GET /api/staff/leave-requests should return 200').toBe(200)
  const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(response)
  return (body?.items ?? []).find((item) => item.id === id)?.status
}

async function findPendingNotificationId(
  request: APIRequestContext,
  token: string,
  leaveRequestId: string,
): Promise<string> {
  let notificationId: string | null = null
  await expect
    .poll(async () => {
      const { items } = await listNotifications(request, token, { type: PENDING_TYPE, pageSize: 50 })
      const match = items.find((item) => item.sourceEntityId === leaveRequestId)
      notificationId = typeof match?.id === 'string' ? match.id : null
      return notificationId
    }, { message: 'the approver should receive the pending leave notification', timeout: 15_000 })
    .not.toBeNull()
  return notificationId!
}

async function dismissPendingLeaveNotifications(
  request: APIRequestContext,
  tokens: string[],
  leaveRequestId: string | null,
): Promise<void> {
  if (!leaveRequestId) return
  for (const token of tokens) {
    const listed = await listNotifications(request, token, { type: PENDING_TYPE, pageSize: 100 }).catch(() => null)
    for (const item of listed?.items ?? []) {
      if (item.sourceEntityId !== leaveRequestId || typeof item.id !== 'string') continue
      await dismissNotificationIfExists(request, token, item.id)
    }
  }
}

async function executeApprove(request: APIRequestContext, token: string, notificationId: string) {
  return apiRequest(request, 'POST', `/api/notifications/${encodeURIComponent(notificationId)}/action`, {
    token,
    data: { actionId: 'approve' },
  })
}

async function loginAs(page: Page, email: string): Promise<void> {
  const form = new URLSearchParams()
  form.set('email', email)
  form.set('password', PASSWORD)
  const response = await page.request.post('/api/auth/login', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: form.toString(),
  })
  expect(response.ok(), 'custom user should log in').toBeTruthy()
  await page.goto('/backend', { waitUntil: 'domcontentloaded' })
  await page.waitForURL(/\/backend(?:\/.*)?$/)
}

test.describe('TC-NOTIF-019: notification actions keep the target command authorization boundary', () => {
  test('a notifications.create holder cannot plant a command action, and the target record survives', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const scope = getTokenScope(adminToken)
    const stamp = Date.now()
    let actor: Actor | null = null
    let warehouseId: string | null = null
    let locationId: string | null = null
    let linkOnlyId: string | null = null

    try {
      const warehouse = await apiRequest(request, 'POST', '/api/wms/warehouses', {
        token: adminToken,
        data: {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          name: `QA TC-NOTIF-019 Warehouse ${stamp}`,
          code: `QA-N19-WH-${stamp}`,
          isActive: true,
          timezone: 'UTC',
        },
      })
      expect(warehouse.ok(), 'warehouse fixture should be created').toBeTruthy()
      warehouseId = (await readJsonSafe<{ id?: string }>(warehouse))?.id ?? null
      const location = await apiRequest(request, 'POST', '/api/wms/locations', {
        token: adminToken,
        data: {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          warehouseId,
          code: `QA-N19-BIN-${stamp}`,
          type: 'bin',
          isActive: true,
        },
      })
      expect(location.ok(), 'location fixture should be created').toBeTruthy()
      locationId = (await readJsonSafe<{ id?: string }>(location))?.id ?? null
      expect(locationId, 'location fixture should have an id').toBeTruthy()

      actor = await createActor(request, superadminToken, scope.organizationId, scope.tenantId, 'planter', BASE_FEATURES)

      const directDelete = await apiRequest(request, 'DELETE', `/api/wms/locations?id=${encodeURIComponent(locationId!)}`, {
        token: actor.token,
      })
      expect(directDelete.status(), 'the actor must not be able to delete the location through its route').toBe(403)

      const planted = await apiRequest(request, 'POST', '/api/notifications', {
        token: actor.token,
        data: {
          recipientUserId: actor.userId,
          type: `qa.notifications.tc019.${stamp}`,
          title: 'QA TC-NOTIF-019 planted action',
          sourceEntityId: locationId,
          actions: [{ id: 'run', label: 'Run', commandId: 'wms.locations.delete' }],
        },
      })
      expect(planted.status(), 'creating an action with a commandId should be refused').toBe(400)
      const plantedBody = await readJsonSafe<{ error?: string; code?: string }>(planted)
      expect(plantedBody?.code).toBe(COMMAND_NOT_ALLOWED_CODE)
      expect(typeof plantedBody?.error === 'string' && plantedBody.error.length > 0).toBe(true)

      const plantedForFeature = await apiRequest(request, 'POST', '/api/notifications/feature', {
        token: actor.token,
        data: {
          requiredFeature: 'notifications.create',
          type: `qa.notifications.tc019.${stamp}`,
          title: 'QA TC-NOTIF-019 planted action',
          sourceEntityId: locationId,
          actions: [{ id: 'run', label: 'Run', commandId: 'wms.locations.delete' }],
        },
      })
      expect(plantedForFeature.status(), 'the bulk create routes refuse a commandId as well').toBe(400)
      expect((await readJsonSafe<{ code?: string }>(plantedForFeature))?.code).toBe(COMMAND_NOT_ALLOWED_CODE)

      const { items } = await listNotifications(request, actor.token, { type: `qa.notifications.tc019.${stamp}`, pageSize: 20 })
      expect(items, 'no notification should have been created').toHaveLength(0)

      const linkOnly = await apiRequest(request, 'POST', '/api/notifications', {
        token: actor.token,
        data: {
          recipientUserId: actor.userId,
          type: `qa.notifications.tc019.link.${stamp}`,
          title: 'QA TC-NOTIF-019 link action',
          actions: [{ id: 'view', label: 'View', href: '/backend/notifications' }],
        },
      })
      expect(linkOnly.status(), 'link-only actions are still accepted').toBe(201)
      linkOnlyId = (await readJsonSafe<{ id?: string }>(linkOnly))?.id ?? null

      const stillThere = await apiRequest(request, 'GET', `/api/wms/locations?ids=${encodeURIComponent(locationId!)}`, { token: adminToken })
      expect(stillThere.status()).toBe(200)
      const stillThereBody = await readJsonSafe<{ items?: Array<{ id?: string }> }>(stillThere)
      expect((stillThereBody?.items ?? []).some((item) => item.id === locationId), 'the location must survive').toBe(true)
    } finally {
      await dismissNotificationIfExists(request, actor?.token ?? null, linkOnlyId)
      if (locationId) {
        await apiRequest(request, 'DELETE', `/api/wms/locations?id=${encodeURIComponent(locationId)}`, { token: adminToken }).catch(() => undefined)
      }
      if (warehouseId) {
        await apiRequest(request, 'DELETE', `/api/wms/warehouses?id=${encodeURIComponent(warehouseId)}`, { token: adminToken }).catch(() => undefined)
      }
      await deleteUserIfExists(request, superadminToken, actor?.userId ?? null)
      await deleteRoleIfExists(request, superadminToken, actor?.roleId ?? null)
    }
  })

  test('a declared action is refused once the clicker loses its required feature, and runs again when restored', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const scope = getTokenScope(adminToken)
    let actor: Actor | null = null
    let memberId: string | null = null
    let leaveRequestId: string | null = null

    try {
      actor = await createActor(request, superadminToken, scope.organizationId, scope.tenantId, 'approver', [
        ...BASE_FEATURES,
        LEAVE_MANAGE_FEATURE,
      ])
      memberId = await createStaffTeamMemberFixture(request, adminToken, { displayName: `QA TC-NOTIF-019 ${Date.now()}` })
      leaveRequestId = await createPendingLeaveRequest(request, adminToken, memberId)
      const notificationId = await findPendingNotificationId(request, actor.token, leaveRequestId)

      await setRoleAclFeatures(request, superadminToken, { roleId: actor.roleId, features: BASE_FEATURES, organizations: null })

      const refused = await executeApprove(request, actor.token, notificationId)
      expect(refused.status(), 'approving without staff.leave_requests.manage should be refused').toBe(403)
      const refusedBody = await readJsonSafe<{ error?: string; code?: string }>(refused)
      expect(refusedBody?.code).toBe(ACTION_FORBIDDEN_CODE)
      expect(typeof refusedBody?.error === 'string' && refusedBody.error.length > 0).toBe(true)
      expect(await readLeaveStatus(request, adminToken, leaveRequestId)).toBe('pending')

      await setRoleAclFeatures(request, superadminToken, {
        roleId: actor.roleId,
        features: [...BASE_FEATURES, LEAVE_MANAGE_FEATURE],
        organizations: null,
      })

      const approved = await executeApprove(request, actor.token, notificationId)
      expect(approved.status(), 'approving with the feature should succeed').toBe(200)
      expect(await readLeaveStatus(request, adminToken, leaveRequestId)).toBe('approved')
    } finally {
      await dismissPendingLeaveNotifications(request, [adminToken, superadminToken], leaveRequestId)
      await deleteStaffEntityIfExists(request, adminToken, LEAVE_REQUESTS_PATH, leaveRequestId)
      await deleteStaffEntityIfExists(request, adminToken, MEMBERS_PATH, memberId)
      await deleteUserIfExists(request, superadminToken, actor?.userId ?? null)
      await deleteRoleIfExists(request, superadminToken, actor?.roleId ?? null)
    }
  })

  test('the bell panel shows the translated refusal when the action is forbidden', async ({ page, request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const scope = getTokenScope(adminToken)
    let actor: Actor | null = null
    let memberId: string | null = null
    let leaveRequestId: string | null = null

    try {
      actor = await createActor(request, superadminToken, scope.organizationId, scope.tenantId, 'ui', [
        ...BASE_FEATURES,
        LEAVE_MANAGE_FEATURE,
      ])
      memberId = await createStaffTeamMemberFixture(request, adminToken, { displayName: `QA TC-NOTIF-019 UI ${Date.now()}` })
      leaveRequestId = await createPendingLeaveRequest(request, adminToken, memberId)
      await findPendingNotificationId(request, actor.token, leaveRequestId)

      await setRoleAclFeatures(request, superadminToken, { roleId: actor.roleId, features: BASE_FEATURES, organizations: null })

      await loginAs(page, actor.email)
      await page.getByRole('button', { name: /notifications/i }).first().click()
      const approveButton = page.getByRole('button', { name: 'Approve', exact: true }).first()
      await expect(approveButton).toBeVisible()
      const actionResponse = page.waitForResponse((response) =>
        /\/api\/notifications\/[^/]+\/action$/.test(new URL(response.url()).pathname),
      )
      await approveButton.click()
      expect((await actionResponse).status()).toBe(403)
      await expect(page.getByText('You are not allowed to run this notification action')).toBeVisible()
      expect(await readLeaveStatus(request, adminToken, leaveRequestId)).toBe('pending')
    } finally {
      await dismissPendingLeaveNotifications(request, [adminToken, superadminToken], leaveRequestId)
      await deleteStaffEntityIfExists(request, adminToken, LEAVE_REQUESTS_PATH, leaveRequestId)
      await deleteStaffEntityIfExists(request, adminToken, MEMBERS_PATH, memberId)
      await deleteUserIfExists(request, superadminToken, actor?.userId ?? null)
      await deleteRoleIfExists(request, superadminToken, actor?.roleId ?? null)
    }
  })
})
