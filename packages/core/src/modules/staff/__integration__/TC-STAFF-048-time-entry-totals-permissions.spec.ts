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

const ENTRIES_PATH = '/api/staff/timesheets/time-entries'
const PROJECTS_PATH = '/api/staff/timesheets/time-projects'
const MEMBERS_PATH = '/api/staff/team-members'

type EntryList = {
  items: Array<Record<string, unknown>>
  total: number
  totals: {
    entryCount: number
    durationMinutes: number
    roundedMinutes: number
    money?: Array<{ currencyCode: string | null; amount: number; amountExact?: string }>
  }
}

async function readEntries(request: APIRequestContext, token: string, query: URLSearchParams): Promise<EntryList> {
  const response = await apiRequest(request, 'GET', `${ENTRIES_PATH}?${query}`, { token })
  expect(response.status(), 'The live time-entry list should allow the viewer').toBe(200)
  const body = await readJsonSafe<EntryList>(response)
  expect(body?.totals, 'includeTotals must exercise the real aggregate query').toBeDefined()
  return body as EntryList
}

function advancedFilter(field: string, value: string): URLSearchParams {
  return new URLSearchParams({
    includeTotals: 'true',
    'filter[conditions][0][field]': field,
    'filter[conditions][0][op]': 'equals',
    'filter[conditions][0][value]': value,
  })
}

function expectEmpty(body: EntryList): void {
  expect(body.items).toEqual([])
  expect(body.total).toBe(0)
  expect(body.totals).toMatchObject({ entryCount: 0, durationMinutes: 0, roundedMinutes: 0 })
}

test('TC-STAFF-048: live totals enforce rates, self-entry and project guards against advanced filters', async ({ request }) => {
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
    customer = await createTestCustomer(request, adminToken, { displayName: `QA048 customer ${stamp}` })
    const memberId = await createRecord(MEMBERS_PATH, { displayName: `QA048 entry author ${stamp}` })
    const projectIds: string[] = []
    const entryIds: string[] = []
    for (const [index, currencyCode] of ['EUR', 'PLN'].entries()) {
      const projectId = await createRecord(PROJECTS_PATH, {
        name: `QA048 project ${index} ${stamp}`,
        code: `Q48-${index}-${stamp}`,
        customerId: customer.id,
        status: 'active',
        hourlyRate: index === 0 ? 120 : 75,
        currencyCode,
        billableByDefault: true,
      })
      projectIds.push(projectId)
      const assignment = await apiRequest(request, 'POST', `${PROJECTS_PATH}/${projectId}/employees`, {
        token: adminToken,
        data: { staffMemberId: memberId, status: 'active', assignedStartDate: '2020-01-01' },
      })
      expect(assignment.ok(), 'The entry author should belong to each fixture project').toBe(true)
      entryIds.push(await createRecord(ENTRIES_PATH, {
        staffMemberId: memberId,
        timeProjectId: projectId,
        date: `2031-02-0${index + 3}`,
        durationMinutes: (index + 1) * 60,
        source: 'manual',
        isBillable: true,
        notes: `QA048 entry ${index} ${stamp}`,
      }))
    }

    const allEntries = new URLSearchParams({ ids: entryIds.join(','), includeTotals: 'true' })
    const baseline = await readEntries(request, adminToken, allEntries)
    expect(baseline.items.map((entry) => entry.id).sort()).toEqual([...entryIds].sort())
    expect(baseline.total).toBe(2)
    expect(baseline.totals).toEqual({
      entryCount: 2, durationMinutes: 180, roundedMinutes: 180,
      money: [{ currencyCode: 'EUR', amount: 120, amountExact: '120' }, { currencyCode: 'PLN', amount: 150, amountExact: '150' }],
    })

    await withCredentialIsolatedRequest(async (provisionRequest) => {
      const superadminToken = await getAuthToken(provisionRequest, 'superadmin')
      for (const access of ['no-rates', 'project-member', 'entry-manager-no-projects', 'view-only'] as const) {
        const roleId = await createRoleFixture(provisionRequest, superadminToken, {
          name: `qa-staff-048-${access}-${stamp}`, tenantId,
        })
        roleIds.push(roleId)
        await setRoleAclFeatures(provisionRequest, superadminToken, {
          roleId,
          features: [
            'staff.timesheets.view',
            ...(access === 'view-only' ? [] : ['staff.timesheets.manage_all']),
            ...(access === 'no-rates' ? ['staff.timesheets.projects.manage'] : []),
            ...(access === 'project-member' ? ['staff.timesheets.rates.view'] : []),
          ],
          organizations: [organizationId],
        })
        const email = `qa-staff-048-${access}-${stamp}@example.com`
        const userId = await createUserFixture(provisionRequest, superadminToken, {
          email, password, organizationId, roles: [roleId], name: `QA048 ${access} ${stamp}`,
        })
        userIds.push(userId)
        if (access === 'project-member') {
          const viewerMemberId = await createRecord(MEMBERS_PATH, { displayName: `QA048 viewer ${stamp}`, userId })
          const assignment = await apiRequest(request, 'POST', `${PROJECTS_PATH}/${projectIds[0]}/employees`, {
            token: adminToken,
            data: { staffMemberId: viewerMemberId, status: 'active', assignedStartDate: '2020-01-01' },
          })
          expect(assignment.ok(), 'The restricted viewer should belong only to project A').toBe(true)
        }

        await withCredentialIsolatedRequest(async (viewerRequest) => {
          const viewerToken = await getAuthToken(viewerRequest, email, password)
          if (access === 'no-rates') {
            const body = await readEntries(viewerRequest, viewerToken, allEntries)
            expect(body.items.map((entry) => entry.id).sort()).toEqual([...entryIds].sort())
            expect(body.total).toBe(2)
            expect(body.totals).toEqual({ entryCount: 2, durationMinutes: 180, roundedMinutes: 180 })
            for (const entry of body.items) {
              expect(entry).not.toHaveProperty('cost')
              expect(entry).not.toHaveProperty('rate_override_amount')
              expect(entry).not.toHaveProperty('currencyCode')
              expect(entry).not.toHaveProperty('rate_currency_code')
            }
          } else if (access === 'project-member') {
            const allowed = await readEntries(viewerRequest, viewerToken, advancedFilter('time_project_id', projectIds[0]))
            expect(allowed.items.map((entry) => entry.id)).toEqual([entryIds[0]])
            expect(allowed.total).toBe(1)
            expect(allowed.totals).toEqual({
              entryCount: 1, durationMinutes: 60, roundedMinutes: 60,
              money: [{ currencyCode: 'EUR', amount: 120, amountExact: '120' }],
            })
            const forbiddenQuery = advancedFilter('time_project_id', projectIds[1])
            forbiddenQuery.set('filter[logic]', 'or')
            forbiddenQuery.set('filter[conditions][1][field]', 'id')
            forbiddenQuery.set('filter[conditions][1][op]', 'equals')
            forbiddenQuery.set('filter[conditions][1][value]', entryIds[1])
            forbiddenQuery.set('filter[conditions][1][join]', 'or')
            const authorized = await readEntries(request, adminToken, forbiddenQuery)
            expect(authorized.items.map((entry) => entry.id)).toEqual([entryIds[1]])
            expect(authorized.totals.money).toEqual([{ currencyCode: 'PLN', amount: 150, amountExact: '150' }])
            const forbidden = await readEntries(viewerRequest, viewerToken, forbiddenQuery)
            expectEmpty(forbidden)
            expect(forbidden.totals.money).toEqual([])
          } else if (access === 'view-only') {
            const query = advancedFilter('id', entryIds[1])
            const response = await apiRequest(viewerRequest, 'GET', `${ENTRIES_PATH}?${query}`, { token: viewerToken })
            expect(response.status(), 'The view-only caller without a staff profile must be rejected by the self-entry interceptor').toBe(403)
            const denied = await readJsonSafe<Record<string, unknown>>(response)
            expect(denied).toHaveProperty('error')
            expect(denied).not.toHaveProperty('items')
            expect(denied).not.toHaveProperty('totals')
            expect(denied).not.toHaveProperty('money')
          } else {
            const query = advancedFilter('id', entryIds[1])
            query.set('ids', entryIds[1])
            const forbidden = await readEntries(viewerRequest, viewerToken, query)
            expectEmpty(forbidden)
            expect(forbidden.totals).not.toHaveProperty('money')
          }
        })
      }
    })
  } finally {
    for (const record of [...records].reverse()) {
      const response = await apiRequest(request, 'DELETE', `${record.path}?id=${record.id}`, { token: adminToken })
      expect(response.ok(), `Cleanup should delete ${record.path}/${record.id}`).toBe(true)
    }
    if (customer) await customer.cleanup()
    await withCredentialIsolatedRequest(async (provisionRequest) => {
      const superadminToken = await getAuthToken(provisionRequest, 'superadmin')
      for (const userId of userIds) await deleteUserIfExists(provisionRequest, superadminToken, userId)
      for (const roleId of roleIds) await deleteRoleIfExists(provisionRequest, superadminToken, roleId)
    })
  }
})
