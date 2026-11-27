import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { listNotifications, dismissNotificationIfExists } from '@open-mercato/core/helpers/integration/notificationsFixtures'
import { createStaffTeamMemberFixture, deleteStaffEntityIfExists } from '@open-mercato/core/helpers/integration/staffFixtures'

export const integrationMeta = { dependsOnModules: ['notifications', 'staff', 'record_locks'] }

const resourceKind = 'staff.leave_request'

test('TC-NOTIF-031: a target lock blocks direct and notification approval; release permits the same action', async ({ request }) => {
  const adminToken = await getAuthToken(request, 'admin')
  const lockOwnerToken = await getAuthToken(request, 'superadmin')
  const scope = getTokenScope(adminToken)
  const ownerHeaders = {
    cookie: `om_selected_tenant=${encodeURIComponent(scope.tenantId)}; om_selected_org=${encodeURIComponent(scope.organizationId)}`,
  }
  let previousSettings: Record<string, unknown> | null = null
  let memberId: string | null = null
  let leaveId: string | null = null
  let lockToken: string | null = null

  try {
    const settingsResponse = await apiRequest(request, 'GET', '/api/record_locks/settings', { token: adminToken })
    expect(settingsResponse.status()).toBe(200)
    previousSettings = (await readJsonSafe<{ settings: Record<string, unknown> }>(settingsResponse))?.settings ?? null
    expect(previousSettings).toBeTruthy()
    const configure = await apiRequest(request, 'POST', '/api/record_locks/settings', {
      token: adminToken,
      data: { ...previousSettings, enabled: true, strategy: 'pessimistic', enabledResources: [resourceKind] },
    })
    expect(configure.status()).toBe(200)

    memberId = await createStaffTeamMemberFixture(request, adminToken, { displayName: `Target guard ${randomUUID()}` })
    const start = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000)
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
    const create = await apiRequest(request, 'POST', '/api/staff/leave-requests', {
      token: adminToken,
      data: { memberId, startDate: start.toISOString(), endDate: end.toISOString(), timezone: 'UTC' },
    })
    expect(create.status()).toBe(201)
    leaveId = (await readJsonSafe<{ id: string }>(create))?.id ?? null
    expect(leaveId).toBeTruthy()
    let notificationId: string | null = null
    await expect.poll(async () => {
      const { items } = await listNotifications(request, adminToken, { type: 'staff.leave_request.pending', sourceEntityId: leaveId! })
      const found = items.find((item) => item.sourceEntityId === leaveId)
      notificationId = typeof found?.id === 'string' ? found.id : null
      return notificationId
    }).toBeTruthy()

    const acquire = await apiRequest(request, 'POST', '/api/record_locks/acquire', {
      token: lockOwnerToken, headers: ownerHeaders, data: { resourceKind, resourceId: leaveId },
    })
    expect(acquire.status()).toBe(200)
    lockToken = (await readJsonSafe<{ lock: { token: string } }>(acquire))?.lock?.token ?? null
    expect(lockToken).toBeTruthy()

    const direct = await apiRequest(request, 'POST', '/api/staff/leave-requests/accept', {
      token: adminToken, data: { id: leaveId },
    })
    expect(direct.status()).toBe(423)
    expect((await readJsonSafe<{ code: string }>(direct))?.code).toBe('record_locked')
    const actionPath = `/api/notifications/${notificationId}/action`
    const blocked = await apiRequest(request, 'POST', actionPath, { token: adminToken, data: { actionId: 'approve' } })
    expect(blocked.status()).toBe(423)
    expect((await readJsonSafe<{ code: string }>(blocked))?.code).toBe('record_locked')

    const pending = await listNotifications(request, adminToken, { sourceEntityId: leaveId! })
    expect(pending.items.find((item) => item.id === notificationId)?.status).toBe('unread')
    const targetResponse = await apiRequest(request, 'GET', `/api/staff/leave-requests?ids=${leaveId}`, { token: adminToken })
    expect(targetResponse.status()).toBe(200)
    const target = await readJsonSafe<{ items: Array<{ id: string; status: string }> }>(targetResponse)
    expect(target?.items.find((item) => item.id === leaveId)?.status).toBe('pending')

    const release = await apiRequest(request, 'POST', '/api/record_locks/release', {
      token: lockOwnerToken, headers: ownerHeaders,
      data: { resourceKind, resourceId: leaveId, token: lockToken, reason: 'cancelled' },
    })
    expect(release.status()).toBe(200)
    lockToken = null
    const allowed = await apiRequest(request, 'POST', actionPath, { token: adminToken, data: { actionId: 'approve' } })
    expect(allowed.status()).toBe(200)
    const approvedResponse = await apiRequest(request, 'GET', `/api/staff/leave-requests?ids=${leaveId}`, { token: adminToken })
    expect(approvedResponse.status()).toBe(200)
    const approved = await readJsonSafe<{ items: Array<{ id: string; status: string }> }>(approvedResponse)
    expect(approved?.items.find((item) => item.id === leaveId)?.status).toBe('approved')
    const actioned = await listNotifications(request, adminToken, { sourceEntityId: leaveId! })
    expect(actioned.items.find((item) => item.id === notificationId)?.status).toBe('actioned')
    expect((await apiRequest(request, 'POST', actionPath, { token: adminToken, data: { actionId: 'approve' } })).status()).toBe(409)
  } finally {
    if (lockToken && leaveId) {
      await apiRequest(request, 'POST', '/api/record_locks/release', {
        token: lockOwnerToken, headers: ownerHeaders,
        data: { resourceKind, resourceId: leaveId, token: lockToken, reason: 'cancelled' },
      })
    }
    if (previousSettings) {
      expect((await apiRequest(request, 'POST', '/api/record_locks/settings', { token: adminToken, data: previousSettings })).status()).toBe(200)
    }
    if (leaveId) {
      for (const token of [adminToken, lockOwnerToken]) {
        const { items } = await listNotifications(request, token, { sourceEntityId: leaveId })
        for (const item of items) {
          if (typeof item.id === 'string') await dismissNotificationIfExists(request, token, item.id)
        }
      }
    }
    await deleteStaffEntityIfExists(request, adminToken, '/api/staff/leave-requests', leaveId)
    await deleteStaffEntityIfExists(request, adminToken, '/api/staff/team-members', memberId)
  }
})
