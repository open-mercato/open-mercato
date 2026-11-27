import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import { acknowledgeGlobalNotices, login } from '@open-mercato/core/helpers/integration/auth'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteStaffEntityIfExists } from '@open-mercato/core/helpers/integration/staffFixtures'

const MEMBERS_PATH = '/api/staff/team-members'
const INTERACTIONS_PATH = '/api/customers/interactions'
const PEOPLE_PATH = '/api/customers/people'

export const integrationMeta = {
  dependsOnModules: ['staff', 'planner', 'customers'],
}

async function openAvailabilityCalendar(page: Page) {
  await page.getByRole('button', { name: 'Calendar', exact: true }).click()
  await expect(page.getByRole('radiogroup', { name: 'Schedule view' })).toBeVisible()
}

test('Staff schedules show the member’s CRM appointments read-only and keep the schedule on feed failure', async ({ page, request }) => {
  const adminToken = await getAuthToken(request, 'admin')
  const scope = getTokenScope(adminToken)
  const fixtureId = randomUUID()
  const title = `QA Staff availability booking ${fixtureId.slice(0, 8)}`
  const email = `staff-appointment-${fixtureId}@example.com`
  const password = `Qa-${fixtureId}!`
  const now = new Date()
  const startsAt = new Date(now.getFullYear(), now.getMonth(), 15, 12).toISOString()

  await withCredentialIsolatedRequest(async (provisionRequest) => {
    const superadminToken = await getAuthToken(provisionRequest, 'superadmin')
    let roleId: string | null = null
    let userId: string | null = null
    let memberId: string | null = null
    let personId: string | null = null
    const eventIds: string[] = []
    try {
      roleId = await createRoleFixture(provisionRequest, superadminToken, { name: `staff-appointment-${fixtureId}`, tenantId: scope.tenantId })
      await setRoleAclFeatures(provisionRequest, superadminToken, {
        roleId,
        organizations: [scope.organizationId],
        features: ['staff.my_availability.view', 'staff.leave_requests.send', 'planner.view', 'customers.interactions.view'],
      })
      userId = await createUserFixture(provisionRequest, superadminToken, {
        email, password, organizationId: scope.organizationId, roles: [roleId],
      })
      const member = await apiRequest(request, 'POST', MEMBERS_PATH, {
        token: adminToken, data: { userId, displayName: `${title} Member` },
      })
      expect(member.status()).toBe(201)
      memberId = expectId((await readJsonSafe<{ id?: string }>(member))?.id, 'Staff member fixture is created')
      personId = await createPersonFixture(request, adminToken, { firstName: 'QA', lastName: fixtureId, displayName: `${title} Person` })

      for (const assigned of [true, false]) {
        const created = await apiRequest(request, 'POST', INTERACTIONS_PATH, {
          token: adminToken,
          data: {
            entityId: personId,
            interactionType: 'meeting',
            title: assigned ? title : `Unassigned ${title}`,
            status: 'planned',
            scheduledAt: startsAt,
            durationMinutes: 30,
            participants: assigned ? [{ userId, name: title }] : [],
          },
        })
        expect(created.status()).toBe(201)
        eventIds.push(expectId((await readJsonSafe<{ id?: string }>(created))?.id, 'Calendar appointment fixture is created'))
      }

      await login(page, 'admin')
      await page.goto(`/backend/staff/team-members/${memberId}`)
      await page.getByRole('tab', { name: 'Availability', exact: true }).click()
      await openAvailabilityCalendar(page)
      const managerAppointment = page.getByText(title, { exact: true })
      await expect(managerAppointment).toBeVisible()
      await expect(page.getByText(`Unassigned ${title}`, { exact: true })).toHaveCount(0)
      await managerAppointment.click()
      await expect(page.getByRole('dialog')).toHaveCount(0)

      await page.context().clearCookies()
      await getAuthToken(page.request, email, password)
      await acknowledgeGlobalNotices(page)
      await page.goto('/backend/staff/my-availability')
      await openAvailabilityCalendar(page)
      await expect(page.getByText(title, { exact: true })).toBeVisible()

      await page.route('**/api/customers/interactions?**', async (route) => {
        const url = new URL(route.request().url())
        if (url.searchParams.get('actorUserId') === userId) {
          await route.fulfill({ status: 404, json: { error: 'Missing calendar feed' } })
        } else {
          await route.fallback()
        }
      })
      await page.reload()
      await openAvailabilityCalendar(page)
      await expect(page.getByText('Calendar events are unavailable.', { exact: true })).toBeVisible()
      await expect(page.getByText(title, { exact: true })).toHaveCount(0)
      await expect(page.getByRole('radiogroup', { name: 'Schedule view' })).toBeVisible()
    } finally {
      for (const eventId of eventIds) await deleteEntityIfExists(request, adminToken, INTERACTIONS_PATH, eventId)
      await deleteEntityIfExists(request, adminToken, PEOPLE_PATH, personId)
      await deleteStaffEntityIfExists(request, adminToken, MEMBERS_PATH, memberId)
      await deleteUserIfExists(provisionRequest, superadminToken, userId)
      await deleteRoleIfExists(provisionRequest, superadminToken, roleId)
    }
  })
})
