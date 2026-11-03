import { randomUUID } from 'node:crypto'
import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test'
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

test('TC-TT-028: report sheet history enforces money permissions and organization scope', async ({ request }) => {
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
        data: action === 'unlock' ? { reason: 'QATT28 correction' } : {},
      })
      expect(response.status(), `Fixture ${action} should succeed`).toBe(200)
    }
    const exported = await apiRequest(request, 'GET', `${REPORTS_PATH}/${reportId}/export?format=csv`, { token: adminToken })
    expect(exported.status()).toBe(200)
    otherOrganizationId = await createOrganizationFixture(request, superadminToken, { name: `QATT28 other ${stamp}`, tenantId })

    for (const mode of ['reader', 'money', 'denied', 'wrong-org'] as const) {
      const canSeeMoney = mode === 'money'
      const viewerOrganizationId = mode === 'wrong-org' ? otherOrganizationId : organizationId
      const features = [
        'staff.timesheets.projects.manage',
        ...(mode === 'denied' ? [] : ['staff.timesheets.reports.view']),
        ...(canSeeMoney ? ['staff.timesheets.rates.view'] : []),
      ]
      const roleId = await createRoleFixture(request, superadminToken, { name: `qa-tt-028-${stamp}-${mode}`, tenantId })
      roleIds.push(roleId)
      await setRoleAclFeatures(request, superadminToken, { roleId, features, organizations: [viewerOrganizationId] })
      const email = `qa-tt-028-${stamp}-${mode}@example.com`
      userIds.push(await createUserFixture(request, superadminToken, {
        email, password, organizationId: viewerOrganizationId, roles: [roleId], name: `QATT28 ${mode}`,
      }))
      const viewerRequest = await playwrightRequest.newContext()
      viewerContexts.push(viewerRequest)
      const viewerToken = await getAuthToken(viewerRequest, email, password)
      const grantsResponse = await apiRequest(viewerRequest, 'POST', '/api/auth/feature-check', {
        token: viewerToken,
        data: { features: ['staff.timesheets.reports.view', 'staff.timesheets.projects.manage', 'staff.timesheets.rates.view', 'staff.timesheets.lock', 'staff.timesheets.reports.unlock'] },
      })
      expect(grantsResponse.status()).toBe(200)
      const grants = await readJsonSafe<{ granted: string[] }>(grantsResponse)
      expect(grants?.granted.slice().sort()).toEqual(features.slice().sort())
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await apiRequest(viewerRequest, 'GET', `${REPORTS_PATH}/${reportId}/sheet`, { token: viewerToken })
        if (mode === 'denied' || mode === 'wrong-org') {
          expect(response.status()).toBe(mode === 'denied' ? 403 : 404)
          expect(await response.text()).not.toContain('246.9')
          continue
        }
        expect(response.status()).toBe(200)
        const body = await readJsonSafe<{
          totals: { totalAmount: number | null }
          events: Array<{ eventType: string; reason: string | null; metadata: Record<string, unknown> | null }>
        }>(response)
        expect(body?.events).toHaveLength(4)
        const closed = body?.events.filter((event) => event.eventType === 'closed') ?? []
        const unlocked = body?.events.find((event) => event.eventType === 'unlocked')
        const exportedEvent = body?.events.find((event) => event.eventType === 'exported')
        expect(closed).toHaveLength(2)
        for (const event of closed) {
          expect(event.metadata).toMatchObject({ frozenEntryCount: 1, lockedEntryCount: 1 })
          if (canSeeMoney) expect(event.metadata).toMatchObject({ totalAmount: 246.9, currencyCode: 'EUR' })
          else {
            expect(event.metadata).not.toHaveProperty('totalAmount')
            expect(event.metadata).not.toHaveProperty('currencyCode')
          }
        }
        expect(unlocked?.reason).toBe('QATT28 correction')
        expect(unlocked?.metadata).toMatchObject({ unlockedEntryCount: 1, frozenEntryCount: 1, frozenBillableMinutes: 120 })
        expect(exportedEvent?.metadata).toMatchObject({ format: 'csv', rowCount: 1 })
        if (canSeeMoney) {
          expect(unlocked?.metadata).toMatchObject({ frozenTotalAmount: '246.90', currencyCode: 'EUR' })
          expect(body?.totals.totalAmount).toBe(246.9)
        } else {
          expect(unlocked?.metadata).not.toHaveProperty('frozenTotalAmount')
          expect(unlocked?.metadata).not.toHaveProperty('currencyCode')
          expect(body?.totals.totalAmount).toBeNull()
          expect(JSON.stringify(body)).not.toMatch(/123\.45|246\.9/)
        }
      }
    }
  } finally {
    for (const viewerContext of viewerContexts) await viewerContext.dispose()
    if (reportId) await apiRequest(request, 'POST', `${REPORTS_PATH}/${reportId}/unlock`, { token: adminToken, data: { reason: 'QATT28 cleanup' } })
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
