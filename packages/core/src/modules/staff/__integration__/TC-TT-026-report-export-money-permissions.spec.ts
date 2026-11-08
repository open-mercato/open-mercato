import { randomUUID } from 'node:crypto'
import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
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
const PERIOD_FROM = '2026-03-01'
const PERIOD_TO = '2026-03-31'

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

test('TC-TT-026: report exports enforce rates.view across the live CSV and PDF APIs', async ({ request }) => {
  const adminToken = await getAuthToken(request, 'admin')
  const superadminToken = await getAuthToken(request, 'superadmin')
  const { tenantId, organizationId } = getTokenContext(adminToken)
  const stamp = randomUUID().slice(0, 8)
  const password = `QA-${randomUUID()}!aA1`
  const projectName = `QATT26 project ${stamp}`
  const roleIds: string[] = []
  const userIds: string[] = []
  const viewerContexts: APIRequestContext[] = []
  let customer: TestCustomerFixture | null = null
  let memberId: string | null = null
  let projectId: string | null = null
  let entryId: string | null = null
  let reportId: string | null = null

  try {
    customer = await createTestCustomer(request, adminToken, { displayName: `QATT26 customer ${stamp}` })
    memberId = await createRecord(request, adminToken, MEMBERS_PATH, { displayName: `QATT26 member ${stamp}` })
    projectId = await createRecord(request, adminToken, PROJECTS_PATH, {
      name: projectName,
      code: `QT26-${stamp}`,
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
      date: '2026-03-10',
      durationMinutes: 120,
      source: 'manual',
      isBillable: true,
      description: `QATT26 billable work ${stamp}`,
    })
    reportId = await createRecord(request, adminToken, REPORTS_PATH, {
      customerId: customer.id,
      title: `QATT26 report ${stamp}`,
      periodKind: 'custom',
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      timeProjectIds: [projectId],
      showRates: true,
    })

    for (const canSeeMoney of [false, true]) {
      const roleId = await createRoleFixture(request, superadminToken, {
        name: `qa-tt-026-${stamp}-${canSeeMoney}`,
        tenantId,
      })
      roleIds.push(roleId)
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: [
          'staff.timesheets.reports.view',
          ...(canSeeMoney ? ['staff.timesheets.rates.view'] : []),
        ],
        organizations: [organizationId],
      })
      const email = `qa-tt-026-${stamp}-${canSeeMoney}@example.com`
      userIds.push(await createUserFixture(request, superadminToken, {
        email,
        password,
        organizationId,
        roles: [roleId],
        name: `QATT26 viewer ${stamp}`,
      }))
      const viewerRequest = await playwrightRequest.newContext()
      viewerContexts.push(viewerRequest)
      const viewerToken = await getAuthToken(viewerRequest, email, password)

      for (const format of ['csv', 'pdf']) {
        const response = await apiRequest(viewerRequest, 'GET', `${REPORTS_PATH}/${reportId}/export?format=${format}`, {
          token: viewerToken,
          headers: { 'Accept-Language': 'en' },
        })
        expect(response.status(), `${format} should allow a report viewer (rates.view: ${canSeeMoney})`).toBe(200)
        expect(response.headers()['content-disposition']).toContain(`.${format}`)
        const content = (await response.body()).toString(format === 'pdf' ? 'latin1' : 'utf8')
        expect(content).toContain(projectName)
        const monetaryLabels = format === 'csv' ? content.split(/\r?\n/)[0] : content
        if (canSeeMoney) {
          expect(monetaryLabels).toContain('Rate')
          expect(monetaryLabels).toContain('Amount')
          expect(content).toContain('123.45')
          expect(content).toContain('246.90')
        } else {
          expect(monetaryLabels).not.toContain('Rate')
          expect(monetaryLabels).not.toContain('Amount')
          expect(content).not.toContain('123.45')
          expect(content).not.toContain('246.90')
          if (format === 'pdf') expect(content).not.toContain('Total to invoice')
        }
      }
    }
  } finally {
    for (const viewerContext of viewerContexts) await viewerContext.dispose()
    await deleteEntityByPathIfExists(request, adminToken, reportId ? `${REPORTS_PATH}?id=${reportId}` : null)
    await deleteEntityByPathIfExists(request, adminToken, entryId ? `${ENTRIES_PATH}?id=${entryId}` : null)
    await deleteEntityByPathIfExists(request, adminToken, projectId ? `${PROJECTS_PATH}?id=${projectId}` : null)
    await deleteEntityByPathIfExists(request, adminToken, memberId ? `${MEMBERS_PATH}?id=${memberId}` : null)
    if (customer) await customer.cleanup()
    for (const userId of userIds) await deleteUserIfExists(request, superadminToken, userId)
    for (const roleId of roleIds) await deleteRoleIfExists(request, superadminToken, roleId)
  }
})
