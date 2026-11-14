import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture, createUserFixture, deleteRoleIfExists, deleteUserIfExists, setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { deleteEntityByPathIfExists, expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createTestCustomer, type TestCustomerFixture } from './fixtures'

export const integrationMeta = { dependsOnModules: ['customers', 'auth'] }

const PROJECTS = '/api/staff/timesheets/time-projects'
const ENTRIES = '/api/staff/timesheets/time-entries'
const REPORTS = '/api/staff/timesheets/reports'
const MEMBERS = '/api/staff/team-members'

async function createRecord(request: APIRequestContext, token: string, path: string, data: Record<string, unknown>) {
  const response = await apiRequest(request, 'POST', path, { token, data })
  expect(response.status(), `Create fixture at ${path}`).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, `Created fixture at ${path}`)
}

test('TC-TT-035: locked-entry report navigation matches report permission', async ({ page, request }) => {
  const admin = await getAuthToken(request, 'admin')
  const { tenantId, organizationId } = getTokenContext(admin)
  const stamp = randomUUID().slice(0, 8)
  const password = `QA-${randomUUID()}!aA1`
  const date = new Date().toISOString().slice(0, 10)
  const description = `QATT35 work ${stamp}`
  const users: string[] = []
  const roles: string[] = []
  let customer: TestCustomerFixture | null = null
  let memberId: string | null = null
  let projectId: string | null = null
  let entryId: string | null = null
  let reportId: string | null = null
  try {
    customer = await createTestCustomer(request, admin, { displayName: `QATT35 customer ${stamp}` })
    memberId = await createRecord(request, admin, MEMBERS, { displayName: `QATT35 member ${stamp}` })
    projectId = await createRecord(request, admin, PROJECTS, {
      name: `QATT35 project ${stamp}`, code: `QT35-${stamp}`, customerId: customer.id,
      status: 'active', hourlyRate: 100, currencyCode: 'EUR', billableByDefault: true,
    })
    const assignment = await apiRequest(request, 'POST', `${PROJECTS}/${projectId}/employees`, {
      token: admin, data: { staffMemberId: memberId, status: 'active', assignedStartDate: date },
    })
    expect(assignment.ok()).toBe(true)
    entryId = await createRecord(request, admin, ENTRIES, {
      staffMemberId: memberId, timeProjectId: projectId, date, durationMinutes: 60,
      source: 'manual', isBillable: true, description,
    })
    reportId = await createRecord(request, admin, REPORTS, {
      customerId: customer.id, title: `QATT35 report ${stamp}`, periodKind: 'custom',
      periodFrom: date, periodTo: date, timeProjectIds: [projectId],
    })
    const close = await apiRequest(request, 'POST', `${REPORTS}/${reportId}/close`, { token: admin, data: {} })
    expect(close.ok(), 'Fixture report closes and locks the entry').toBe(true)

    for (const canViewReports of [false, true]) {
      const roleId = await createRoleFixture(request, admin, { name: `qa-tt35-${stamp}-${canViewReports}`, tenantId })
      roles.push(roleId)
      await setRoleAclFeatures(request, admin, {
        roleId, organizations: [organizationId],
        features: ['staff.view', 'staff.timesheets.view', 'staff.timesheets.manage_own', 'staff.timesheets.manage_all', 'staff.timesheets.projects.manage',
          ...(canViewReports ? ['staff.timesheets.reports.view'] : [])],
      })
      const email = `qa-tt35-${stamp}-${canViewReports}@example.com`
      users.push(await createUserFixture(request, admin, {
        email, password, organizationId, roles: [roleId], name: `QATT35 user ${stamp}`,
      }))
      await page.context().clearCookies()
      const form = new URLSearchParams({ email, password })
      const login = await page.request.post('/api/auth/login', {
        headers: { 'content-type': 'application/x-www-form-urlencoded' }, data: form.toString(),
      })
      expect(login.ok()).toBe(true)
      const auth = await readJsonSafe<{ token?: string }>(login)
      const viewerToken = auth?.token
      if (!viewerToken) throw new Error('[internal] Fixture login omitted token')
      const report = await apiRequest(page.request, 'GET', `${REPORTS}/${reportId}/sheet`, { token: viewerToken })
      expect(report.status()).toBe(canViewReports ? 200 : 403)
      await page.goto(`/backend/staff/time-tracking/entries?ids=${entryId}`)
      const row = page.getByRole('row').filter({ hasText: description })
      await expect(row).toBeVisible()
      await expect(row.getByTestId('entry-locked-badge')).toBeVisible()
      const actions = row.getByRole('button', { name: 'Open actions', exact: true })
      if (canViewReports) {
        await actions.click()
        await expect(page.getByRole('menuitem', { name: 'Show the report', exact: true }))
          .toHaveAttribute('href', `/backend/staff/time-tracking/reports/${reportId}`)
      } else {
        await expect(actions).toHaveCount(0)
      }
      await test.info().attach(`report-access-${canViewReports}`, { body: await page.screenshot(), contentType: 'image/png' })
    }
  } finally {
    if (reportId) await apiRequest(request, 'POST', `${REPORTS}/${reportId}/unlock`, { token: admin, data: { reason: 'QATT35 fixture cleanup' } })
    await deleteEntityByPathIfExists(request, admin, reportId ? `${REPORTS}?id=${reportId}` : null)
    await deleteEntityByPathIfExists(request, admin, entryId ? `${ENTRIES}?id=${entryId}` : null)
    await deleteEntityByPathIfExists(request, admin, projectId ? `${PROJECTS}?id=${projectId}` : null)
    await deleteEntityByPathIfExists(request, admin, memberId ? `${MEMBERS}?id=${memberId}` : null)
    if (customer) await customer.cleanup()
    for (const userId of users) await deleteUserIfExists(request, admin, userId)
    for (const roleId of roles) await deleteRoleIfExists(request, admin, roleId)
  }
})
