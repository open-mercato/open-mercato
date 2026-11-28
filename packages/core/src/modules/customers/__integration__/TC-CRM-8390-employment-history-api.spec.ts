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
import { createCompanyFixture, createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { expectOperation, redoOk, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'
import {
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_HEADER_NAME,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

export const integrationMeta = { dependsOnModules: ['auth', 'customers', 'audit_logs'] }

type CompanyPerson = {
  id: string
  displayName: string
  linkId?: string | null
  updatedAt?: string | null
  employmentEndedOn?: string | null
}

async function readCompanyPeople(request: APIRequestContext, token: string, path: string) {
  const response = await apiRequest(request, 'GET', path, { token })
  expect(response.status(), `GET ${path}`).toBe(200)
  return readJsonSafe<{ items: CompanyPerson[]; total: number; page: number; pageSize: number }>(response)
}

test('TC-CRM-8390 API: records a departure and relinks the same person–company association', async ({ request }) => {
  const token = await getAuthToken(request, 'admin')
  const { tenantId, organizationId } = getTokenScope(token)
  const stamp = randomUUID()
  const displayName = `Employment history ${stamp}`
  const endedOn = '2024-02-29'
  let personId: string | null = null
  let companyId: string | null = null
  let fallbackId: string | null = null
  let roleId: string | null = null
  let viewerId: string | null = null
  try {
    companyId = await createCompanyFixture(request, token, `Employment company ${stamp}`)
    fallbackId = await createCompanyFixture(request, token, `Employment fallback ${stamp}`)
    personId = await createPersonFixture(request, token, { firstName: 'Employment', lastName: 'History', displayName, companyEntityId: companyId })

    const personPath = `/api/customers/people/${personId}`
    const linksPath = `${personPath}/companies`
    const companyPath = `/api/customers/companies/${companyId}`
    const activePath = `${companyPath}/people`
    const historyPath = `${activePath}?employmentStatus=ended&sort=recent&page=1&pageSize=1`
    const endPath = `${linksPath}/${companyId}/end`
    const linkFallback = await apiRequest(request, 'POST', linksPath, { token, data: { companyId: fallbackId } })
    expect(linkFallback.ok()).toBeTruthy()
    const [active, history, companyBeforeEnd, invalidDate, absentAssociation] = await Promise.all([
      readCompanyPeople(request, token, activePath),
      readCompanyPeople(request, token, historyPath),
      apiRequest(request, 'GET', companyPath, { token }),
      apiRequest(request, 'POST', endPath, { token, data: { endedOn: '2024-02-30' } }),
      apiRequest(request, 'POST', `${linksPath}/${randomUUID()}/end`, { token, data: { endedOn } }),
    ])
    expect(active).toMatchObject({ items: [{ id: personId, displayName }], total: 1 })
    expect(history).toMatchObject({ items: [], total: 0, page: 1, pageSize: 1 })
    expect(companyBeforeEnd.status()).toBe(200)
    expect(await readJsonSafe(companyBeforeEnd)).toMatchObject({ counts: { people: 1 } })
    expect(invalidDate.status()).toBe(400)
    expect(absentAssociation.status()).toBe(404)
    const assignment = active?.items[0]
    if (!assignment?.linkId || !assignment.updatedAt) throw new Error('The active link and its update version are required')

    const viewerEmail = `employment-viewer-${stamp}@example.com`
    const viewerPassword = `Test!${randomUUID()}`
    roleId = await createRoleFixture(request, token, { name: `Employment viewer ${stamp}`, tenantId })
    await setRoleAclFeatures(request, token, {
      roleId, organizations: [organizationId], features: ['customers.companies.view', 'customers.people.view'],
    })
    viewerId = await createUserFixture(request, token, { email: viewerEmail, password: viewerPassword, organizationId, roles: [roleId] })
    await withCredentialIsolatedRequest(async (viewerRequest) => {
      const viewerToken = await getAuthToken(viewerRequest, viewerEmail, viewerPassword)
      const forbidden = await apiRequest(viewerRequest, 'POST', endPath, { token: viewerToken, data: { endedOn } })
      expect(forbidden.status(), 'view-only users cannot end an employment').toBe(403)
    })

    const headers = { [OPTIMISTIC_LOCK_HEADER_NAME]: assignment.updatedAt }
    const ended = await apiRequest(request, 'POST', endPath, { token, data: { endedOn }, headers })
    expect(ended.status(), 'the versioned end action succeeds').toBe(200)
    expect(await readJsonSafe(ended)).toEqual({ ok: true })
    const operation = expectOperation(ended, 'personCompanyLinks.endEmployment')
    expect(operation).toMatchObject({ commandId: 'customers.personCompanyLinks.endEmployment', resourceId: assignment.linkId })

    const [activeAfterEnd, historyAfterEnd, remaining, person, company, stale] = await Promise.all([
      readCompanyPeople(request, token, activePath),
      readCompanyPeople(request, token, historyPath),
      apiRequest(request, 'GET', linksPath, { token }),
      apiRequest(request, 'GET', personPath, { token }),
      apiRequest(request, 'GET', companyPath, { token }),
      apiRequest(request, 'POST', endPath, { token, data: { endedOn: '2024-03-01' }, headers }),
    ])
    expect(activeAfterEnd).toMatchObject({ items: [], total: 0 })
    expect(historyAfterEnd).toMatchObject({ items: [{ id: personId, displayName, employmentEndedOn: endedOn }], total: 1 })
    expect(remaining.status()).toBe(200)
    const personCompanies = await readJsonSafe<{ items: Array<{ companyId: string; isPrimary: boolean }> }>(remaining)
    expect(personCompanies?.items).toHaveLength(1)
    expect(personCompanies?.items[0]).toMatchObject({ companyId: fallbackId, isPrimary: true })
    expect(person.status()).toBe(200)
    expect(await readJsonSafe(person)).toMatchObject({ profile: { companyEntityId: fallbackId } })
    expect(company.status()).toBe(200)
    expect(await readJsonSafe(company)).toMatchObject({ counts: { people: 0 } })
    expect(stale.status()).toBe(409)
    expect(await readJsonSafe(stale)).toMatchObject({ code: OPTIMISTIC_LOCK_CONFLICT_CODE, expectedUpdatedAt: assignment.updatedAt })
    expect(await readCompanyPeople(request, token, historyPath)).toEqual(historyAfterEnd)

    await undoOk(request, token, operation.undoToken, 'ending employment')
    expect(await readCompanyPeople(request, token, activePath)).toMatchObject({ items: [{ id: personId, linkId: assignment.linkId }], total: 1 })
    expect(await readCompanyPeople(request, token, historyPath)).toMatchObject({ items: [], total: 0 })
    await redoOk(request, token, operation.logId, 'ending employment')
    expect(await readCompanyPeople(request, token, historyPath)).toEqual(historyAfterEnd)

    const rejoined = await apiRequest(request, 'POST', linksPath, { token, data: { companyId } })
    expect(rejoined.ok()).toBeTruthy()
    expect(await readJsonSafe(rejoined)).toMatchObject({ result: { id: assignment.linkId, companyId, isPrimary: false } })
    const [activeAfterRejoin, historyAfterRejoin] = await Promise.all([
      readCompanyPeople(request, token, activePath),
      readCompanyPeople(request, token, historyPath),
    ])
    expect(activeAfterRejoin).toMatchObject({ items: [{ id: personId, linkId: assignment.linkId }], total: 1 })
    expect(historyAfterRejoin).toMatchObject({ items: [], total: 0 })
  } finally {
    await deleteUserIfExists(request, token, viewerId)
    await deleteRoleIfExists(request, token, roleId)
    await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    await deleteEntityIfExists(request, token, '/api/customers/companies', fallbackId)
    await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
  }
})
