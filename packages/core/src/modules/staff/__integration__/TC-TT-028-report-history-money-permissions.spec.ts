import { randomUUID } from 'node:crypto'
import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  deleteOrganizationIfExists,
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  deleteEntityByPathIfExists,
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import { createTestCustomer, type TestCustomerFixture } from './fixtures'

export const integrationMeta = {
  dependsOnModules: ['customers', 'auth'],
}

const PROJECTS_PATH = '/api/staff/timesheets/time-projects'
const ENTRIES_PATH = '/api/staff/timesheets/time-entries'
const REPORTS_PATH = '/api/staff/timesheets/reports'
const MEMBERS_PATH = '/api/staff/team-members'
const PERIOD_FROM = '2028-03-01'
const PERIOD_TO = '2028-03-31'

async function createRecord(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', path, { token, data })
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(response.status(), `POST ${path} should create the fixture`).toBe(201)
  return expectId(body?.id, `POST ${path} should return its fixture id`)
}

test('TC-TT-028: report history hides money across close, unlock and export', async ({ request, page }, testInfo) => {
  const adminToken = await getAuthToken(request, 'admin')
  const superadminToken = await getAuthToken(request, 'superadmin')
  const { tenantId, organizationId } = getTokenContext(adminToken)
  const stamp = randomUUID().slice(0, 8)
  const password = `QA-${randomUUID()}!aA1`
  const projectName = `QATT28 project ${stamp}`
  const roleIds: string[] = []
  const userIds: string[] = []
  const viewerContexts: APIRequestContext[] = []
  let customer: TestCustomerFixture | null = null
  let memberId: string | null = null
  let projectId: string | null = null
  let entryId: string | null = null
  let reportId: string | null = null
  let otherOrganizationId: string | null = null

  try {
    customer = await createTestCustomer(request, adminToken, { displayName: `QATT28 customer ${stamp}` })
    memberId = await createRecord(request, adminToken, MEMBERS_PATH, { displayName: `QATT28 member ${stamp}` })
    projectId = await createRecord(request, adminToken, PROJECTS_PATH, {
      name: projectName,
      code: `QT28-${stamp}`,
      customerId: customer.id,
      status: 'active',
      hourlyRate: 123.45,
      currencyCode: 'EUR',
      billableByDefault: true,
    })
    const assignment = await apiRequest(request, 'POST', `${PROJECTS_PATH}/${projectId}/employees`, {
      token: adminToken,
      data: { staffMemberId: memberId, status: 'active', assignedStartDate: PERIOD_FROM },
    })
    expect(assignment.ok(), 'The fixture member should be assigned to the project').toBe(true)
    entryId = await createRecord(request, adminToken, ENTRIES_PATH, {
      staffMemberId: memberId,
      timeProjectId: projectId,
      date: '2028-03-10',
      durationMinutes: 120,
      source: 'manual',
      isBillable: true,
      description: `QATT28 billable work ${stamp}`,
    })
    reportId = await createRecord(request, adminToken, REPORTS_PATH, {
      customerId: customer.id,
      title: `QATT28 report ${stamp}`,
      periodKind: 'custom',
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      timeProjectIds: [projectId],
      showRates: true,
    })

    for (const action of ['close', 'unlock', 'close']) {
      const response = await apiRequest(request, 'POST', `${REPORTS_PATH}/${reportId}/${action}`, {
        token: adminToken,
        data: action === 'unlock' ? { reason: 'Corrected allocation' } : {},
      })
      expect(response.status()).toBe(200)
    }
    const exportResponse = await apiRequest(request, 'GET', `${REPORTS_PATH}/${reportId}/export?format=csv`, { token: adminToken })
    expect(exportResponse.status()).toBe(200)
    otherOrganizationId = await createOrganizationFixture(request, superadminToken, { tenantId, name: `History isolation ${stamp}` })

    for (const mode of ['time', 'money', 'denied', 'other-org']) {
      const canSeeMoney = mode === 'money'
      const viewerOrganizationId = mode === 'other-org' ? otherOrganizationId : organizationId
      const roleId = await createRoleFixture(request, superadminToken, {
        name: `qa-tt-028-${stamp}-${mode}`,
        tenantId,
      })
      roleIds.push(roleId)
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: [
          'staff.timesheets.projects.manage',
          ...(mode === 'denied' ? [] : ['staff.timesheets.reports.view']),
          ...(canSeeMoney ? ['staff.timesheets.rates.view'] : []),
        ],
        organizations: [viewerOrganizationId],
      })
      const email = `qa-tt-028-${stamp}-${mode}@example.com`
      userIds.push(await createUserFixture(request, superadminToken, {
        email,
        password,
        organizationId: viewerOrganizationId,
        roles: [roleId],
        name: `QATT28 viewer ${stamp}`,
      }))
      const viewerRequest = await playwrightRequest.newContext()
      viewerContexts.push(viewerRequest)
      const viewerToken = await getAuthToken(viewerRequest, email, password)

      const grantsResponse = await apiRequest(viewerRequest, 'POST', '/api/auth/feature-check', {
        token: viewerToken,
        data: { features: ['staff.timesheets.reports.view', 'staff.timesheets.rates.view', 'staff.timesheets.projects.manage'] },
      })
      expect(grantsResponse.status()).toBe(200)
      const grants = await readJsonSafe<{ granted: string[] }>(grantsResponse)
      expect(grants?.granted.slice().sort()).toEqual([
        'staff.timesheets.projects.manage',
        ...(mode === 'denied' ? [] : ['staff.timesheets.reports.view']),
        ...(canSeeMoney ? ['staff.timesheets.rates.view'] : []),
      ].sort())

      for (const repeat of [0, 1]) {
        const response = await apiRequest(viewerRequest, 'GET', `${REPORTS_PATH}/${reportId}/sheet`, { token: viewerToken })
        if (mode === 'denied' || mode === 'other-org') {
          expect(response.status()).toBe(mode === 'denied' ? 403 : 404)
          continue
        }
        expect(response.status(), `History read ${repeat}`).toBe(200)
        const sheet = await readJsonSafe<{
          totals: { totalAmount: number | null }
          events: Array<{ eventType: string; reason: string | null; metadata: Record<string, unknown> | null }>
        }>(response)
        expect(sheet?.events).toHaveLength(4)
        const closes = sheet?.events.filter((event) => event.eventType === 'closed') ?? []
        expect(closes).toHaveLength(2)
        for (const closed of closes) {
          expect(closed.metadata).toMatchObject({ frozenEntryCount: 1, lockedEntryCount: 1 })
          if (canSeeMoney) expect(closed.metadata).toMatchObject({ totalAmount: 246.9, currencyCode: 'EUR' })
          else expect(closed.metadata).not.toHaveProperty('totalAmount')
        }
        const unlocked = sheet?.events.find((event) => event.eventType === 'unlocked')
        expect(unlocked?.reason).toBe('Corrected allocation')
        expect(unlocked?.metadata).toMatchObject({ unlockedEntryCount: 1, frozenBillableMinutes: 120 })
        expect(sheet?.events.find((event) => event.eventType === 'exported')?.metadata).toMatchObject({ format: 'csv', rowCount: 1 })
        if (canSeeMoney) {
          expect(unlocked?.metadata).toMatchObject({ frozenTotalAmount: '246.90', currencyCode: 'EUR' })
          expect(sheet?.totals.totalAmount).toBe(246.9)
        } else {
          expect(unlocked?.metadata).not.toHaveProperty('frozenTotalAmount')
          expect(sheet?.totals.totalAmount).toBeNull()
          expect(JSON.stringify(sheet)).not.toMatch(/123\.45|246\.9/)
          for (const event of sheet?.events ?? []) expect(event.metadata).not.toHaveProperty('currencyCode')
        }
      }
    }
    await login(page, 'admin')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/backend/staff/time-tracking/reports/${reportId}`)
    const region = page.getByRole('region', { name: 'Locked entries' })
    await expect(region).toBeVisible()
    await expect(region.getByRole('table')).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await expect.poll(() => region.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
    await region.focus()
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
    await testInfo.attach('report-mobile', { body: await page.screenshot(), contentType: 'image/png' })
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(region).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await testInfo.attach('report-desktop', { body: await page.screenshot(), contentType: 'image/png' })

  } finally {
    for (const viewerContext of viewerContexts) await viewerContext.dispose()
    if (reportId) await apiRequest(request, 'POST', `${REPORTS_PATH}/${reportId}/unlock`, { token: adminToken, data: { reason: 'Fixture cleanup' } })
    await deleteEntityByPathIfExists(request, adminToken, reportId ? `${REPORTS_PATH}?id=${reportId}` : null)
    await deleteEntityByPathIfExists(request, adminToken, entryId ? `${ENTRIES_PATH}?id=${entryId}` : null)
    await deleteEntityByPathIfExists(request, adminToken, projectId ? `${PROJECTS_PATH}?id=${projectId}` : null)
    await deleteEntityByPathIfExists(request, adminToken, memberId ? `${MEMBERS_PATH}?id=${memberId}` : null)
    if (customer) await customer.cleanup()
    for (const userId of userIds) await deleteUserIfExists(request, superadminToken, userId)
    for (const roleId of roleIds) await deleteRoleIfExists(request, superadminToken, roleId)
    await deleteOrganizationIfExists(request, superadminToken, otherOrganizationId)
  }
})
