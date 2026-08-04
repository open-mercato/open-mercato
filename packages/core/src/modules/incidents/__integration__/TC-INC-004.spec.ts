import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['incidents'],
}

const INCIDENTS_API = '/api/incidents'
const SEVERITIES_API = '/api/incidents/severities'

type Scope = {
  organizationId: string
  tenantId: string
}

type ListResponse<T> = {
  items?: T[]
}

type IncidentRecord = {
  id: string
  title?: string | null
  acknowledged_at?: string | null
}

type SeverityRecord = {
  id: string
}

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function uniqueTitle(prefix: string): string {
  return `${prefix} ${uniqueSuffix()}`
}

function itemsFrom<T>(body: ListResponse<T> | null): T[] {
  return Array.isArray(body?.items) ? body.items : []
}

async function fetchSeededSeverityId(request: APIRequestContext, token: string): Promise<string> {
  const response = await apiRequest(request, 'GET', `${SEVERITIES_API}?isActive=true&pageSize=100`, { token })
  expect(response.status(), 'seeded severities should be readable').toBe(200)
  const body = await readJsonSafe<ListResponse<SeverityRecord>>(response)
  const severity = itemsFrom(body).find((item) => typeof item.id === 'string' && item.id.length > 0)
  expect(severity, 'at least one seeded incident severity should exist').toBeTruthy()
  return severity!.id
}

async function createIncident(
  request: APIRequestContext,
  token: string,
  scope: Scope,
  title: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', INCIDENTS_API, {
    token,
    data: {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      title,
      description: 'Playwright RBAC/isolation integration fixture',
      severityId: await fetchSeededSeverityId(request, token),
    },
  })
  expect(response.status(), 'POST /api/incidents should create an incident').toBe(201)
  const body = await readJsonSafe<{ id?: unknown }>(response)
  return expectId(body?.id, 'created incident should return an id')
}

async function readIncident(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<IncidentRecord> {
  const response = await apiRequest(request, 'GET', `${INCIDENTS_API}?id=${encodeURIComponent(id)}`, { token })
  expect(response.status(), 'GET /api/incidents?id=... should succeed').toBe(200)
  const body = await readJsonSafe<ListResponse<IncidentRecord>>(response)
  const item = itemsFrom(body).find((record) => record.id === id)
  expect(item, `incident ${id} should be returned by owner detail GET`).toBeTruthy()
  return item!
}

async function deleteIncidentIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  if (!token || !id) return
  await apiRequest(request, 'DELETE', `${INCIDENTS_API}?id=${encodeURIComponent(id)}`, { token }).catch(() => undefined)
}

test.describe('TC-INC-004: Incident RBAC and organization isolation', () => {
  test('incident APIs return 403 to a principal without incidents features', async ({ request }) => {
    const stamp = uniqueSuffix()
    const password = 'Incident-View-1!'
    const email = `qa-incidents-rbac-${stamp}@acme.com`
    const roleName = `qa_incidents_rbac_${stamp}`

    let adminToken: string | null = null
    let restrictedToken: string | null = null
    let roleId: string | null = null
    let userId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const scope = getTokenContext(adminToken)
      roleId = await createRoleFixture(request, adminToken, {
        name: roleName,
        tenantId: scope.tenantId,
      })
      await setRoleAclFeatures(request, adminToken, { roleId, features: [] })

      userId = await createUserFixture(request, adminToken, {
        email,
        password,
        organizationId: scope.organizationId,
        roles: [roleId],
        name: 'QA Incidents No-Access User',
      })
      restrictedToken = await getAuthToken(request, email, password)

      const listResponse = await apiRequest(request, 'GET', INCIDENTS_API, { token: restrictedToken })
      expect(listResponse.status(), 'GET /api/incidents without incidents.incident.view should return 403').toBe(403)

      const createResponse = await apiRequest(request, 'POST', INCIDENTS_API, {
        token: restrictedToken,
        data: {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          title: uniqueTitle('INC forbidden create'),
          severityId: await fetchSeededSeverityId(request, adminToken),
        },
      })
      expect(createResponse.status(), 'POST /api/incidents without incidents.incident.create should return 403').toBe(403)
    } finally {
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })

  test('a user scoped to another organization cannot read or mutate an incident', async ({ request }) => {
    const stamp = uniqueSuffix()
    const password = 'Incident-Scope-1!'
    const userEmail = `qa-incidents-scope-${stamp}@acme.com`

    let adminToken: string | null = null
    let superadminToken: string | null = null
    let orgBId: string | null = null
    let roleId: string | null = null
    let userBId: string | null = null
    let userBToken: string | null = null
    let incidentId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      superadminToken = await getAuthToken(request, 'superadmin')
      const adminScope = getTokenContext(adminToken)

      orgBId = await createOrganizationFixture(request, superadminToken, {
        name: `QA Incidents Scope Org ${stamp}`,
        tenantId: adminScope.tenantId,
      })
      roleId = await createRoleFixture(request, superadminToken, {
        name: `qa_incidents_scope_${stamp}`,
        tenantId: adminScope.tenantId,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: ['incidents.*'],
        organizations: null,
      })
      userBId = await createUserFixture(request, superadminToken, {
        email: userEmail,
        password,
        organizationId: orgBId,
        roles: [roleId],
        name: 'QA Incidents Org B User',
      })
      await setUserAclVisibility(request, superadminToken, {
        userId: userBId,
        organizations: [orgBId],
      })
      userBToken = await getAuthToken(request, userEmail, password)
      expect(getTokenContext(userBToken).organizationId, 'cross-scope user home org should be org B').toBe(orgBId)
      expect(getTokenContext(userBToken).tenantId, 'cross-scope user should share the admin tenant').toBe(adminScope.tenantId)

      const originalTitle = uniqueTitle('INC org A')
      incidentId = await createIncident(request, adminToken, adminScope, originalTitle)

      const crossListResponse = await apiRequest(
        request,
        'GET',
        `${INCIDENTS_API}?id=${encodeURIComponent(incidentId)}`,
        { token: userBToken },
      )
      expect(crossListResponse.status(), 'cross-org incident list lookup should return an empty scoped list').toBe(200)
      const crossList = await readJsonSafe<ListResponse<IncidentRecord>>(crossListResponse)
      expect(
        itemsFrom(crossList).some((item) => item.id === incidentId),
        'cross-org user must not list the org A incident by id',
      ).toBe(false)

      const crossUpdate = await apiRequest(request, 'PUT', INCIDENTS_API, {
        token: userBToken,
        data: {
          id: incidentId,
          title: uniqueTitle('INC forbidden update'),
        },
      })
      expect([403, 404], 'cross-org update should be denied or hidden').toContain(crossUpdate.status())

      const crossAcknowledge = await apiRequest(
        request,
        'POST',
        `${INCIDENTS_API}/${incidentId}/acknowledge`,
        { token: userBToken },
      )
      expect([403, 404], 'cross-org action should be denied or hidden').toContain(crossAcknowledge.status())

      const ownerView = await readIncident(request, adminToken, incidentId)
      expect(ownerView.title, 'cross-org update must not modify the owner org incident').toBe(originalTitle)
      expect(ownerView.acknowledged_at, 'cross-org action must not acknowledge the owner org incident').toBeNull()
    } finally {
      await deleteIncidentIfExists(request, adminToken, incidentId)
      await deleteUserIfExists(request, superadminToken, userBId)
      await deleteRoleIfExists(request, superadminToken, roleId)
      await deleteOrganizationIfExists(request, superadminToken, orgBId)
    }
  })
})
