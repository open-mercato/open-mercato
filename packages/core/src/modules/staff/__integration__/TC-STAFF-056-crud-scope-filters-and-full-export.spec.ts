import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createTestCustomer, type TestCustomerFixture } from './fixtures'

export const integrationMeta = { dependsOnModules: ['customers', 'auth'] }

const LEAVE_PATH = '/api/staff/leave-requests'
const PROJECTS_PATH = '/api/staff/timesheets/time-projects'
const MEMBERS_PATH = '/api/staff/team-members'

type ListBody = { items?: Array<{ id?: string }> }

async function listIds(request: APIRequestContext, token: string, path: string, query: URLSearchParams): Promise<string[]> {
  const response = await apiRequest(request, 'GET', `${path}?${query}`, { token })
  expect(response.status(), `GET ${path} should answer 200`).toBe(200)
  const body = await readJsonSafe<ListBody>(response)
  return (body?.items ?? []).map((item) => String(item.id))
}

async function fullExportText(request: APIRequestContext, token: string, path: string): Promise<string> {
  const response = await apiRequest(request, 'GET', `${path}?format=json&exportScope=full`, { token })
  expect(response.status(), `GET ${path} full export should answer 200`).toBe(200)
  return response.text()
}

function advancedFilter(field: string, op: string, value?: string): URLSearchParams {
  const query = new URLSearchParams({
    pageSize: '100',
    'filter[conditions][0][field]': field,
    'filter[conditions][0][op]': op,
  })
  if (value !== undefined) query.set('filter[conditions][0][value]', value)
  return query
}

test('TC-STAFF-056: advanced filters and full exports keep buildFilters row scope (#9016, #9896, #9015)', async ({ request }) => {
  const adminToken = await getAuthToken(request, 'admin')
  const { tenantId, organizationId } = getTokenContext(adminToken)
  const stamp = randomUUID().slice(0, 8)
  const password = `QA-${randomUUID()}!aA1`
  const roleIds: string[] = []
  const userIds: string[] = []
  const records: Array<{ path: string; id: string }> = []
  let customer: TestCustomerFixture | null = null

  const createRecord = async (path: string, data: Record<string, unknown>): Promise<string> => {
    const response = await apiRequest(request, 'POST', path, { token: adminToken, data })
    expect(response.status(), `POST ${path} should create its fixture`).toBe(201)
    const id = expectId((await readJsonSafe<{ id?: string }>(response))?.id, `POST ${path} should return an id`)
    records.push({ path, id })
    return id
  }

  try {
    customer = await createTestCustomer(request, adminToken, { displayName: `QA056 customer ${stamp}` })
    const absentMemberId = await createRecord(MEMBERS_PATH, { displayName: `QA056 colleague ${stamp}` })
    const leaveId = await createRecord(LEAVE_PATH, {
      memberId: absentMemberId,
      startDate: new Date(Date.now() + 40 * 86_400_000).toISOString(),
      endDate: new Date(Date.now() + 42 * 86_400_000).toISOString(),
      timezone: 'UTC',
    })
    const memberProjectId = await createRecord(PROJECTS_PATH, {
      name: `QA056 member project ${stamp}`, code: `Q56-A-${stamp}`, customerId: customer.id, status: 'active',
    })
    const foreignProjectId = await createRecord(PROJECTS_PATH, {
      name: `QA056 foreign project ${stamp}`, code: `Q56-B-${stamp}`, customerId: customer.id, status: 'active',
    })

    const tokens = await withCredentialIsolatedRequest(async (provisionRequest) => {
      const superadminToken = await getAuthToken(provisionRequest, 'superadmin')
      const emails: Record<'noStaff' | 'projectViewer', string> = {
        noStaff: `qa-staff-056-none-${stamp}@example.com`,
        projectViewer: `qa-staff-056-viewer-${stamp}@example.com`,
      }
      const featuresFor: Record<'noStaff' | 'projectViewer', string[]> = {
        noStaff: ['customers.people.view'],
        projectViewer: ['staff.timesheets.projects.view'],
      }
      for (const access of ['noStaff', 'projectViewer'] as const) {
        const roleId = await createRoleFixture(provisionRequest, superadminToken, { name: `qa-staff-056-${access}-${stamp}`, tenantId })
        roleIds.push(roleId)
        await setRoleAclFeatures(provisionRequest, superadminToken, { roleId, features: featuresFor[access], organizations: [organizationId] })
        const userId = await createUserFixture(provisionRequest, superadminToken, {
          email: emails[access], password, organizationId, roles: [roleId], name: `QA056 ${access} ${stamp}`,
        })
        userIds.push(userId)
        if (access === 'projectViewer') {
          const viewerMemberId = await createRecord(MEMBERS_PATH, { displayName: `QA056 viewer ${stamp}`, userId })
          const assignment = await apiRequest(request, 'POST', `${PROJECTS_PATH}/${memberProjectId}/employees`, {
            token: adminToken,
            data: { staffMemberId: viewerMemberId, status: 'active', assignedStartDate: '2020-01-01' },
          })
          expect(assignment.ok(), 'The viewer should belong to the member project').toBe(true)
        }
      }
      return {
        noStaff: await getAuthToken(provisionRequest, emails.noStaff, password),
        projectViewer: await getAuthToken(provisionRequest, emails.projectViewer, password),
      }
    })

    const leaveOverride = await listIds(request, tokens.noStaff, LEAVE_PATH, advancedFilter('id', 'is_not_empty'))
    expect(leaveOverride, 'An id advanced filter must not replace the deny-all scope').not.toContain(leaveId)
    expect(await fullExportText(request, tokens.noStaff, LEAVE_PATH), 'A full export must keep the deny-all scope').not.toContain(leaveId)

    const projectOverride = await listIds(request, tokens.projectViewer, PROJECTS_PATH, advancedFilter('id', 'is', foreignProjectId))
    expect(projectOverride, 'An id advanced filter must not widen past project membership').not.toContain(foreignProjectId)
    const memberOnly = await listIds(request, tokens.projectViewer, PROJECTS_PATH, new URLSearchParams({ pageSize: '100' }))
    expect(memberOnly).toContain(memberProjectId)
    expect(memberOnly).not.toContain(foreignProjectId)
    const projectExport = await fullExportText(request, tokens.projectViewer, PROJECTS_PATH)
    expect(projectExport, 'A full export must keep project membership scope').not.toContain(foreignProjectId)
  } finally {
    for (const record of [...records].reverse()) {
      await apiRequest(request, 'DELETE', `${record.path}?id=${encodeURIComponent(record.id)}`, { token: adminToken }).catch(() => undefined)
    }
    await customer?.cleanup().catch(() => undefined)
    await withCredentialIsolatedRequest(async (cleanupRequest) => {
      const superadminToken = await getAuthToken(cleanupRequest, 'superadmin')
      for (const userId of userIds) await deleteUserIfExists(cleanupRequest, superadminToken, userId)
      for (const roleId of roleIds) await deleteRoleIfExists(cleanupRequest, superadminToken, roleId)
    }).catch(() => undefined)
  }
})
