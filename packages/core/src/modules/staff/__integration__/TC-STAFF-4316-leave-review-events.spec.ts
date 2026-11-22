import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createUserFixture, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteStaffEntityIfExists } from '@open-mercato/core/helpers/integration/staffFixtures'
import { skipIfUndoTestsDisabled, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'

export const integrationMeta = { dependsOnModules: ['staff', 'planner', 'customers'] }

const membersPath = '/api/staff/team-members'
const leavePath = '/api/staff/leave-requests'
const interactionsPath = '/api/customers/interactions'
const peoplePath = '/api/customers/people'

test('TC-STAFF-4316: leave review shows overlapping appointments and keeps approval available without CRM context', async ({ page, request }) => {
  test.slow()
  skipIfUndoTestsDisabled()
  const token = await getAuthToken(request, 'admin')
  const { organizationId } = getTokenScope(token)
  const stamp = randomUUID().slice(0, 8)
  const memberName = `QA Leave Reviewer ${stamp}`
  const overlapTitle = `Overlapping appointment ${stamp}`
  const priorTitle = `Appointment ending at leave start ${stamp}`
  const nextTitle = `Appointment starting at leave end ${stamp}`
  const date = '2027-03-14'

  await withCredentialIsolatedRequest(async (provisionRequest) => {
    const root = await getAuthToken(provisionRequest, 'superadmin')
    let staffUserId: string | null = null
    let memberId: string | null = null
    let leaveId: string | null = null
    let personId: string | null = null
    let approvalUndoToken: string | null = null
    const interactionIds: string[] = []
    const expectLeaveStatus = async (status: 'pending' | 'approved') => {
      const result = await apiRequest(request, 'GET', `${leavePath}?ids=${leaveId}`, { token })
      expect(result.status()).toBe(200)
      const body = await readJsonSafe<{ items: Array<{ id: string; status: string }> }>(result)
      expect(body?.items).toEqual([expect.objectContaining({ id: leaveId, status })])
    }
    try {
      staffUserId = await createUserFixture(provisionRequest, root, {
        email: `leave-review-${stamp}@example.com`, password: `Qa-${stamp}Date!987`, name: memberName, organizationId, roles: [],
      })
      const member = await apiRequest(request, 'POST', membersPath, { token, data: { displayName: memberName, userId: staffUserId } })
      expect(member.status()).toBe(201)
      memberId = expectId((await readJsonSafe<{ id?: string }>(member))?.id, 'A linked Staff member is created')
      const leave = await apiRequest(request, 'POST', leavePath, {
        token, data: { memberId, startDate: date, endDate: date, timezone: 'America/New_York' },
      })
      expect(leave.status()).toBe(201)
      leaveId = expectId((await readJsonSafe<{ id?: string }>(leave))?.id, 'A pending leave request is created')
      personId = await createPersonFixture(request, token, { firstName: 'Leave', lastName: stamp, displayName: `QA Leave person ${stamp}` })

      for (const [title, scheduledAt] of [
        [priorTitle, '2027-03-14T04:30:00Z'],
        [overlapTitle, '2027-03-14T04:50:00Z'],
        [nextTitle, '2027-03-15T04:00:00Z'],
      ]) {
        const created = await apiRequest(request, 'POST', interactionsPath, {
          token,
          data: {
            entityId: personId, interactionType: 'meeting', title, status: 'planned',
            scheduledAt, durationMinutes: 30, participants: [{ userId: staffUserId, name: memberName }],
          },
        })
        expect(created.status()).toBe(201)
        interactionIds.push(expectId((await readJsonSafe<{ id?: string }>(created))?.id, 'An appointment is created'))
      }

      await login(page, 'admin')
      await page.goto(`/backend/staff/leave-requests/${leaveId}`)
      const scheduledEvents = page.getByRole('region', { name: 'Scheduled events' })
      const approve = page.getByRole('button', { name: 'Approve', exact: true })
      await expect(scheduledEvents.getByText('1 scheduled event', { exact: true })).toBeVisible()
      await expect(scheduledEvents.getByText(overlapTitle, { exact: true })).toBeVisible()
      await expect(scheduledEvents.getByText(priorTitle, { exact: true })).toHaveCount(0)
      await expect(scheduledEvents.getByText(nextTitle, { exact: true })).toHaveCount(0)
      await expect(approve).toBeEnabled()

      await page.route(
        (url) => url.pathname === interactionsPath && url.searchParams.get('actorUserId') === staffUserId,
        (route) => route.fulfill({ status: 404, json: {} }),
      )
      await page.reload()
      await expect(scheduledEvents.getByText('Scheduled events are unavailable.', { exact: true })).toBeVisible()
      await expect(scheduledEvents.getByText(overlapTitle, { exact: true })).toHaveCount(0)
      await expect(approve).toBeEnabled()

      const [approved] = await Promise.all([
        page.waitForResponse((response) => new URL(response.url()).pathname === `${leavePath}/accept` && response.request().method() === 'POST'),
        approve.click(),
      ])
      expect(approved.status()).toBe(200)
      const header = await approved.headerValue('x-om-operation')
      const operation = header ? JSON.parse(decodeURIComponent(header.replace(/^omop:/, ''))) as { undoToken?: unknown } : null
      approvalUndoToken = expectId(operation?.undoToken, 'The approval response includes an undo token')
      await expectLeaveStatus('approved')
    } finally {
      try {
        if (approvalUndoToken) {
          await undoOk(request, token, approvalUndoToken, 'leave approval with unavailable CRM context')
          await expectLeaveStatus('pending')
        }
      } finally {
        for (const interactionId of interactionIds) await deleteEntityIfExists(request, token, interactionsPath, interactionId)
        await deleteEntityIfExists(request, token, peoplePath, personId)
        await deleteStaffEntityIfExists(request, token, leavePath, leaveId)
        await deleteStaffEntityIfExists(request, token, membersPath, memberId)
        await deleteUserIfExists(provisionRequest, root, staffUserId)
      }
    }
  })
})
