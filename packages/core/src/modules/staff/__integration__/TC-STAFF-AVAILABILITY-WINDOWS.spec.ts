import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { deleteStaffEntityIfExists } from '@open-mercato/core/helpers/integration/staffFixtures'
import { expectOperation, skipIfUndoTestsDisabled, undoByToken } from '@open-mercato/core/helpers/integration/undoHarness'

const MEMBERS_PATH = '/api/staff/team-members'
const LEAVE_PATH = '/api/staff/leave-requests'
const WINDOWS_PATH = '/api/staff/availability/windows'

test('Calendar readers see scoped leave windows while source readers also see the configured reason', async ({ request }) => {
  skipIfUndoTestsDisabled()
  const fixtureId = randomUUID()
  const password = `Qa-${fixtureId}!`
  const email = `staff-windows-${fixtureId}@example.com`
  const reason = 'Scheduled absence'
  const adminToken = await getAuthToken(request, 'admin')
  const { tenantId, organizationId } = getTokenScope(adminToken)

  await withCredentialIsolatedRequest(async (provisionRequest) => {
    const superadminToken = await getAuthToken(provisionRequest, 'superadmin')
    let roleId: string | null = null
    let userId: string | null = null
    let memberId: string | null = null
    let leaveId: string | null = null
    let approvalUndoToken: string | null = null
    let otherOrganizationId: string | null = null

    try {
      otherOrganizationId = await createOrganizationFixture(provisionRequest, superadminToken, {
        tenantId,
        name: `QA Staff windows other organization ${fixtureId}`,
      })
      roleId = await createRoleFixture(provisionRequest, superadminToken, { tenantId, name: `qa-staff-windows-${fixtureId}` })
      await setRoleAclFeatures(provisionRequest, superadminToken, {
        roleId, features: ['customers.interactions.view'], organizations: [organizationId],
      })
      userId = await createUserFixture(provisionRequest, superadminToken, { email, password, organizationId, roles: [roleId] })
      const member = await apiRequest(request, 'POST', MEMBERS_PATH, {
        token: adminToken,
        data: { userId, displayName: `QA Staff windows ${fixtureId}` },
      })
      expect(member.status()).toBe(201)
      memberId = expectId((await readJsonSafe<{ id?: string }>(member))?.id, 'Staff member is created')

      const date = '2027-03-14'
      const query = new URLSearchParams({
        organizationId,
        userIds: userId,
        from: '2027-03-14T00:00:00Z',
        to: '2027-03-16T00:00:00Z',
      })
      const window = { start: '2027-03-14T05:00:00.000Z', end: '2027-03-15T04:00:00.000Z' }
      const created = await apiRequest(request, 'POST', LEAVE_PATH, {
        token: adminToken,
        data: {
          memberId,
          startDate: date,
          endDate: date,
          timezone: 'America/New_York',
          unavailabilityReasonValue: reason,
          note: 'Private leave note',
        },
      })
      expect(created.status()).toBe(201)
      leaveId = expectId((await readJsonSafe<{ id?: string }>(created))?.id, 'Leave request is created')

      await withCredentialIsolatedRequest(async (viewerRequest) => {
        const viewerToken = await getAuthToken(viewerRequest, email, password)
        const pending = await apiRequest(viewerRequest, 'GET', `${WINDOWS_PATH}?${query}`, { token: viewerToken })
        expect(pending.status()).toBe(200)
        expect(await readJsonSafe(pending)).toEqual({
          items: [{ userId, organizationId, windows: [{ ...window, kind: 'tentative' }] }],
        })

        const deniedQuery = new URLSearchParams(query)
        deniedQuery.set('organizationId', otherOrganizationId!)
        const denied = await apiRequest(viewerRequest, 'GET', `${WINDOWS_PATH}?${deniedQuery}`, { token: viewerToken })
        expect(denied.status()).toBe(403)
      })

      const approved = await apiRequest(request, 'POST', `${LEAVE_PATH}/accept`, {
        token: adminToken,
        data: { id: leaveId, decisionComment: 'Private approval comment' },
      })
      expect(approved.status()).toBe(200)
      approvalUndoToken = expectOperation(approved, 'Leave approval fixture').undoToken
      const response = await apiRequest(request, 'GET', `${WINDOWS_PATH}?${query}`, { token: adminToken })
      expect(response.status()).toBe(200)
      expect(await readJsonSafe(response)).toEqual({
        items: [{ userId, organizationId, windows: [{ ...window, kind: 'leave', reason }] }],
      })
    } finally {
      if (approvalUndoToken) await undoByToken(request, adminToken, approvalUndoToken).catch(() => undefined)
      await deleteStaffEntityIfExists(request, adminToken, LEAVE_PATH, leaveId)
      await deleteStaffEntityIfExists(request, adminToken, MEMBERS_PATH, memberId)
      await deleteUserIfExists(provisionRequest, superadminToken, userId)
      await deleteRoleIfExists(provisionRequest, superadminToken, roleId)
      await deleteOrganizationIfExists(provisionRequest, superadminToken, otherOrganizationId)
    }
  })
})
