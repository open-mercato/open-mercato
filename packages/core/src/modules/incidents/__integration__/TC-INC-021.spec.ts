import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_HEADER_NAME,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

export const integrationMeta = {
  dependsOnModules: ['incidents'],
}

const INCIDENTS_API = '/api/incidents'
const SEVERITIES_API = '/api/incidents/severities'
const COMPONENTS_API = '/api/incidents/service-components'
const DEPENDENCIES_API = '/api/incidents/service-dependencies'
const BASE_URL = process.env.BASE_URL?.trim() || ''
const TEST_PASSWORD = 'Incident-ServiceCatalog-1!'

type Scope = {
  organizationId: string
  tenantId: string
}

type ListResponse<T> = {
  items?: T[]
}

type ComponentRecord = {
  id: string
  key?: string | null
  name?: string | null
  is_active?: boolean | null
  updated_at?: string | null
}

type DependencyRecord = {
  id: string
  source_component_id?: string | null
  target_component_id?: string | null
  dependency_kind?: string | null
}

type ServiceContextResponse = {
  incidentId?: string
  impactedComponentIds?: string[]
  freeformComponentLabels?: string[]
  components?: Array<{ id: string; impacted?: boolean }>
  dependencies?: Array<{ id: string; sourceComponentId?: string; targetComponentId?: string }>
}

let token = ''
let scope: Scope
const createdComponentIds = new Set<string>()
const createdDependencyIds = new Set<string>()
const createdIncidentIds = new Set<string>()

function resolveApiUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

function authHeaders(authToken: string, lockValue?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${authToken}`,
    'Content-Type': 'application/json',
  }
  if (lockValue) headers[OPTIMISTIC_LOCK_HEADER_NAME] = lockValue
  return headers
}

function uniqueSuffix(): string {
  return `${Date.now()}-${randomUUID().slice(0, 8)}`
}

function itemsFrom<T>(body: ListResponse<T> | null): T[] {
  return Array.isArray(body?.items) ? body.items : []
}

function scopeCookie(tenantId: string, organizationId: string | null): string {
  return `om_selected_tenant=${encodeURIComponent(tenantId)}; om_selected_org=${encodeURIComponent(organizationId ?? '__all__')}`
}

async function apiRequestWithCookie(
  request: APIRequestContext,
  method: string,
  path: string,
  options: { token: string; cookie: string; data?: unknown },
) {
  return request.fetch(resolveApiUrl(path), {
    method,
    headers: {
      Authorization: `Bearer ${options.token}`,
      'Content-Type': 'application/json',
      Cookie: options.cookie,
    },
    data: options.data,
  })
}

async function fetchSeverityId(request: APIRequestContext): Promise<string> {
  const response = await apiRequest(request, 'GET', `${SEVERITIES_API}?isActive=true&pageSize=100`, { token })
  expect(response.status(), 'GET /api/incidents/severities should succeed').toBe(200)
  const body = await readJsonSafe<ListResponse<{ id: string }>>(response)
  const severity = itemsFrom(body).find((item) => typeof item.id === 'string' && item.id.length > 0)
  expect(severity, 'at least one active severity should exist').toBeTruthy()
  return severity!.id
}

async function createComponent(
  request: APIRequestContext,
  input: { key: string; name: string; componentType?: string; criticality?: string },
): Promise<string> {
  const response = await apiRequest(request, 'POST', COMPONENTS_API, {
    token,
    data: {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      key: input.key,
      name: input.name,
      componentType: input.componentType ?? 'service',
      criticality: input.criticality ?? 'medium',
    },
  })
  expect(response.status(), 'POST /api/incidents/service-components should create a component').toBe(201)
  const body = await readJsonSafe<{ id?: unknown }>(response)
  const id = expectId(body?.id, 'component creation response should include id')
  createdComponentIds.add(id)
  return id
}

async function readComponent(request: APIRequestContext, id: string, authToken = token): Promise<ComponentRecord | null> {
  const response = await apiRequest(request, 'GET', `${COMPONENTS_API}?id=${encodeURIComponent(id)}`, { token: authToken })
  expect(response.status(), 'GET /api/incidents/service-components?id=... should succeed').toBe(200)
  const body = await readJsonSafe<ListResponse<ComponentRecord>>(response)
  return itemsFrom(body).find((item) => item.id === id) ?? null
}

async function createDependency(
  request: APIRequestContext,
  input: { sourceComponentId: string; targetComponentId: string; dependencyKind?: string },
): Promise<string> {
  const response = await apiRequest(request, 'POST', DEPENDENCIES_API, {
    token,
    data: {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      sourceComponentId: input.sourceComponentId,
      targetComponentId: input.targetComponentId,
      dependencyKind: input.dependencyKind ?? 'depends_on',
    },
  })
  expect(response.status(), 'POST /api/incidents/service-dependencies should create a dependency').toBe(201)
  const body = await readJsonSafe<{ id?: unknown }>(response)
  const id = expectId(body?.id, 'dependency creation response should include id')
  createdDependencyIds.add(id)
  return id
}

async function createIncident(request: APIRequestContext): Promise<string> {
  const response = await apiRequest(request, 'POST', INCIDENTS_API, {
    token,
    data: {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      title: `INC service-context ${uniqueSuffix()}`,
      description: 'Playwright service-context fixture',
      severityId: await fetchSeverityId(request),
    },
  })
  expect(response.status(), 'POST /api/incidents should create an incident').toBe(201)
  const body = await readJsonSafe<{ id?: unknown }>(response)
  const id = expectId(body?.id, 'created incident should return id')
  createdIncidentIds.add(id)
  return id
}

async function addImpact(
  request: APIRequestContext,
  incidentId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const response = await apiRequest(request, 'POST', `${INCIDENTS_API}/${encodeURIComponent(incidentId)}/impacts`, {
    token,
    data: { organizationId: scope.organizationId, tenantId: scope.tenantId, ...data },
  })
  expect(response.status(), `POST impacts should succeed for ${JSON.stringify(data)}`).toBe(200)
}

async function fetchServiceContext(
  request: APIRequestContext,
  incidentId: string,
  authToken = token,
): Promise<{ status: number; body: ServiceContextResponse | null }> {
  const response = await apiRequest(
    request,
    'GET',
    `${INCIDENTS_API}/${encodeURIComponent(incidentId)}/service-context`,
    { token: authToken },
  )
  const body = response.ok() ? await readJsonSafe<ServiceContextResponse>(response) : null
  return { status: response.status(), body }
}

async function deleteComponentIfExists(request: APIRequestContext, id: string | null, authToken = token): Promise<void> {
  if (!authToken || !id) return
  try {
    await apiRequest(request, 'DELETE', `${COMPONENTS_API}?id=${encodeURIComponent(id)}`, { token: authToken })
  } catch {
    // Cleanup must not mask the primary assertion failure.
  } finally {
    createdComponentIds.delete(id)
  }
}

async function deleteDependencyIfExists(request: APIRequestContext, id: string | null, authToken = token): Promise<void> {
  if (!authToken || !id) return
  try {
    await apiRequest(request, 'DELETE', `${DEPENDENCIES_API}?id=${encodeURIComponent(id)}`, { token: authToken })
  } catch {
    // Cleanup must not mask the primary assertion failure.
  } finally {
    createdDependencyIds.delete(id)
  }
}

async function deleteIncidentIfExists(request: APIRequestContext, id: string | null): Promise<void> {
  if (!token || !id) return
  try {
    await apiRequest(request, 'DELETE', `${INCIDENTS_API}?id=${encodeURIComponent(id)}`, { token })
  } catch {
    // Cleanup must not mask the primary assertion failure.
  } finally {
    createdIncidentIds.delete(id)
  }
}

async function setRoleAclFeaturesForTenant(
  request: APIRequestContext,
  authToken: string,
  input: { roleId: string; tenantId: string; features: string[]; organizations?: string[] | null },
): Promise<void> {
  const response = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
    token: authToken,
    data: {
      roleId: input.roleId,
      tenantId: input.tenantId,
      features: input.features,
      organizations: input.organizations ?? null,
    },
  })
  expect(response.status(), 'PUT /api/auth/roles/acl should return 200').toBe(200)
}

async function createTenantFixture(request: APIRequestContext, authToken: string, name: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/directory/tenants', { token: authToken, data: { name } })
  expect(response.status(), 'POST /api/directory/tenants should return 201').toBe(201)
  const body = await readJsonSafe<{ id?: unknown }>(response)
  return expectId(body?.id, 'tenant creation response should include id')
}

async function createOrganizationInTenant(
  request: APIRequestContext,
  authToken: string,
  tenantId: string,
  name: string,
): Promise<string> {
  const response = await apiRequestWithCookie(request, 'POST', '/api/directory/organizations', {
    token: authToken,
    cookie: scopeCookie(scope.tenantId, scope.organizationId),
    data: { tenantId, name },
  })
  expect(response.status(), 'POST /api/directory/organizations should return 201').toBe(201)
  const body = await readJsonSafe<{ id?: unknown }>(response)
  return expectId(body?.id, 'organization creation response should include id')
}

test.describe('TC-INC-021: Incident service catalog + dependency context', () => {
  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin')
    scope = getTokenContext(token)
  })

  test.afterAll(async ({ request }) => {
    for (const id of Array.from(createdDependencyIds)) await deleteDependencyIfExists(request, id)
    for (const id of Array.from(createdComponentIds)) await deleteComponentIfExists(request, id)
    for (const id of Array.from(createdIncidentIds)) await deleteIncidentIfExists(request, id)
  })

  test('creates, lists, filters, updates, and validates service components and dependencies', async ({ request }) => {
    const stamp = uniqueSuffix()
    let checkoutId: string | null = null
    let paymentsId: string | null = null
    let dependencyId: string | null = null

    try {
      checkoutId = await createComponent(request, { key: `checkout-${stamp}`, name: 'Checkout', criticality: 'high' })
      paymentsId = await createComponent(request, { key: `payments-${stamp}`, name: 'Payments' })

      const listResponse = await apiRequest(request, 'GET', `${COMPONENTS_API}?ids=${encodeURIComponent(checkoutId)}`, { token })
      expect(listResponse.status(), 'GET service-components?ids should succeed').toBe(200)
      const listBody = await readJsonSafe<ListResponse<ComponentRecord>>(listResponse)
      const listedIds = itemsFrom(listBody).map((item) => item.id)
      expect(listedIds, 'ids filter should include the requested component').toContain(checkoutId)
      expect(listedIds, 'ids filter should exclude unrequested components').not.toContain(paymentsId)

      const searchResponse = await apiRequest(request, 'GET', `${COMPONENTS_API}?search=${encodeURIComponent(`payments-${stamp}`)}`, { token })
      expect(searchResponse.status(), 'GET service-components?search should succeed').toBe(200)
      const searchBody = await readJsonSafe<ListResponse<ComponentRecord>>(searchResponse)
      expect(itemsFrom(searchBody).some((item) => item.id === paymentsId), 'search should match by key').toBe(true)

      const updateResponse = await apiRequest(request, 'PUT', COMPONENTS_API, {
        token,
        data: { id: checkoutId, organizationId: scope.organizationId, tenantId: scope.tenantId, criticality: 'critical' },
      })
      expect(updateResponse.status(), 'PUT service-components should update').toBe(200)

      const duplicateResponse = await apiRequest(request, 'POST', COMPONENTS_API, {
        token,
        data: { organizationId: scope.organizationId, tenantId: scope.tenantId, key: `checkout-${stamp}`, name: 'Duplicate checkout' },
      })
      expect(duplicateResponse.status(), 'duplicate component key should be rejected 409').toBe(409)

      dependencyId = await createDependency(request, { sourceComponentId: checkoutId, targetComponentId: paymentsId })

      const depDuplicate = await apiRequest(request, 'POST', DEPENDENCIES_API, {
        token,
        data: {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          sourceComponentId: checkoutId,
          targetComponentId: paymentsId,
          dependencyKind: 'depends_on',
        },
      })
      expect(depDuplicate.status(), 'duplicate dependency should be rejected 409').toBe(409)

      const selfLoop = await apiRequest(request, 'POST', DEPENDENCIES_API, {
        token,
        data: {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          sourceComponentId: checkoutId,
          targetComponentId: checkoutId,
        },
      })
      expect(selfLoop.status(), 'self-referential dependency should be rejected 400').toBe(400)

      const deleteResponse = await apiRequest(request, 'DELETE', `${COMPONENTS_API}?id=${encodeURIComponent(checkoutId)}`, { token })
      expect(deleteResponse.status(), 'DELETE service-component should succeed').toBe(200)
      createdComponentIds.delete(checkoutId)

      const depList = await apiRequest(request, 'GET', `${DEPENDENCIES_API}?ids=${encodeURIComponent(dependencyId)}`, { token })
      expect(depList.status(), 'GET service-dependencies?ids should succeed').toBe(200)
      const depBody = await readJsonSafe<ListResponse<DependencyRecord>>(depList)
      expect(itemsFrom(depBody).some((item) => item.id === dependencyId), 'dependency should be cascade soft-deleted with its component').toBe(false)
      createdDependencyIds.delete(dependencyId)
      dependencyId = null
      checkoutId = null
    } finally {
      await deleteDependencyIfExists(request, dependencyId)
      await deleteComponentIfExists(request, checkoutId)
      await deleteComponentIfExists(request, paymentsId)
    }
  })

  test('service-context returns impacted components, first-hop dependencies, and freeform labels', async ({ request }) => {
    const stamp = uniqueSuffix()
    let checkoutId: string | null = null
    let paymentsId: string | null = null
    let dependencyId: string | null = null
    let incidentId: string | null = null

    try {
      checkoutId = await createComponent(request, { key: `sc-checkout-${stamp}`, name: 'SC Checkout' })
      paymentsId = await createComponent(request, { key: `sc-payments-${stamp}`, name: 'SC Payments' })
      dependencyId = await createDependency(request, { sourceComponentId: checkoutId, targetComponentId: paymentsId })
      incidentId = await createIncident(request)

      await addImpact(request, incidentId, { targetType: 'service_component', targetId: checkoutId, impactStatus: 'degraded' })
      await addImpact(request, incidentId, { targetType: 'component', componentLabel: `Legacy ERP ${stamp}`, impactStatus: 'partial_outage' })

      const { status, body } = await fetchServiceContext(request, incidentId)
      expect(status, 'GET service-context should succeed').toBe(200)
      expect(body?.impactedComponentIds ?? [], 'impacted components should include the linked component').toContain(checkoutId)
      expect(body?.freeformComponentLabels ?? [], 'freeform labels should include the legacy component').toContain(`Legacy ERP ${stamp}`)

      const componentIds = (body?.components ?? []).map((component) => component.id)
      expect(componentIds, 'context should include the impacted component').toContain(checkoutId)
      expect(componentIds, 'context should pull in the first-hop dependency target').toContain(paymentsId)
      expect(
        (body?.components ?? []).find((component) => component.id === checkoutId)?.impacted,
        'impacted component should be flagged impacted=true',
      ).toBe(true)
      expect(
        (body?.dependencies ?? []).some((dep) => dep.sourceComponentId === checkoutId && dep.targetComponentId === paymentsId),
        'context should include the checkout→payments dependency edge',
      ).toBe(true)
    } finally {
      await deleteIncidentIfExists(request, incidentId)
      await deleteDependencyIfExists(request, dependencyId)
      await deleteComponentIfExists(request, checkoutId)
      await deleteComponentIfExists(request, paymentsId)
    }
  })

  test('enforces incidents.incident.view for reads and incidents.settings.manage for writes', async ({ request }) => {
    const stamp = uniqueSuffix()
    const roleName = `qa_inc_sc_view_${stamp}`
    const email = `qa-inc-sc-view-${stamp}@acme.com`
    let componentId: string | null = null
    let incidentId: string | null = null
    let roleId: string | null = null
    let userId: string | null = null

    try {
      componentId = await createComponent(request, { key: `rbac-${stamp}`, name: 'RBAC component' })
      incidentId = await createIncident(request)
      await addImpact(request, incidentId, { targetType: 'service_component', targetId: componentId, impactStatus: 'degraded' })

      roleId = await createRoleFixture(request, token, { name: roleName, tenantId: scope.tenantId })
      await setRoleAclFeaturesForTenant(request, token, {
        roleId,
        tenantId: scope.tenantId,
        features: ['incidents.incident.view', 'incidents.incident.manage'],
      })
      userId = await createUserFixture(request, token, {
        email,
        password: TEST_PASSWORD,
        organizationId: scope.organizationId,
        roles: [roleId],
        name: 'QA Incidents Service Catalog Viewer',
      })
      const viewerToken = await getAuthToken(request, email, TEST_PASSWORD)

      const readComponents = await apiRequest(request, 'GET', `${COMPONENTS_API}?ids=${encodeURIComponent(componentId)}`, { token: viewerToken })
      expect(readComponents.status(), 'viewer with incidents.incident.view may list service components').toBe(200)

      const readContext = await fetchServiceContext(request, incidentId, viewerToken)
      expect(readContext.status, 'viewer may read service-context').toBe(200)

      const deniedWrite = await apiRequest(request, 'POST', COMPONENTS_API, {
        token: viewerToken,
        data: { organizationId: scope.organizationId, tenantId: scope.tenantId, key: `denied-${stamp}`, name: 'Denied' },
      })
      expect(deniedWrite.status(), 'viewer without incidents.settings.manage must not create a component (403)').toBe(403)
    } finally {
      await deleteUserIfExists(request, token, userId)
      await deleteRoleIfExists(request, token, roleId)
      await deleteIncidentIfExists(request, incidentId)
      await deleteComponentIfExists(request, componentId)
    }
  })

  test('does not expose tenant A service catalog or service-context to tenant B', async ({ request }) => {
    const superToken = await getAuthToken(request, 'superadmin')
    const stamp = uniqueSuffix()
    let componentAId: string | null = null
    let incidentAId: string | null = null
    let tenantBId: string | null = null
    let orgBId: string | null = null
    let roleBId: string | null = null
    let userBId: string | null = null

    try {
      componentAId = await createComponent(request, { key: `iso-${stamp}`, name: 'Isolated component' })
      incidentAId = await createIncident(request)
      await addImpact(request, incidentAId, { targetType: 'service_component', targetId: componentAId, impactStatus: 'degraded' })

      tenantBId = await createTenantFixture(request, superToken, `TC-INC-021 Tenant B ${stamp}`)
      orgBId = await createOrganizationInTenant(request, superToken, tenantBId, `TC-INC-021 Org B ${stamp}`)
      roleBId = await createRoleFixture(request, superToken, { name: `TC-INC-021 Tenant B Role ${stamp}`, tenantId: tenantBId })
      await setRoleAclFeaturesForTenant(request, superToken, {
        roleId: roleBId,
        tenantId: tenantBId,
        features: ['incidents.settings.manage', 'incidents.incident.view'],
        organizations: null,
      })
      userBId = await createUserFixture(request, superToken, {
        email: `qa-inc-sc-tenant-b-${stamp}@acme.com`,
        password: TEST_PASSWORD,
        organizationId: orgBId,
        roles: [roleBId],
        name: 'QA Incidents Service Catalog Tenant B User',
      })
      const tenantBToken = await getAuthToken(request, `qa-inc-sc-tenant-b-${stamp}@acme.com`, TEST_PASSWORD)
      const tenantBScope = getTokenContext(tenantBToken)
      expect(tenantBScope.tenantId, 'tenant B token should carry tenant B').toBe(tenantBId)

      const crossList = await apiRequest(request, 'GET', `${COMPONENTS_API}?ids=${encodeURIComponent(componentAId)}`, { token: tenantBToken })
      expect(crossList.status(), 'tenant B service-component list should succeed').toBe(200)
      const crossBody = await readJsonSafe<ListResponse<ComponentRecord>>(crossList)
      expect(itemsFrom(crossBody).some((item) => item.id === componentAId), 'tenant B must not see tenant A component').toBe(false)

      const crossContext = await fetchServiceContext(request, incidentAId, tenantBToken)
      expect(crossContext.status, 'tenant B must not read tenant A service-context (404)').toBe(404)
    } finally {
      await deleteIncidentIfExists(request, incidentAId)
      await deleteComponentIfExists(request, componentAId)
      await deleteUserIfExists(request, superToken, userBId)
      await deleteRoleIfExists(request, superToken, roleBId)
      await deleteGeneralEntityIfExists(request, superToken, '/api/directory/organizations', orgBId)
      await deleteGeneralEntityIfExists(request, superToken, '/api/directory/tenants', tenantBId)
    }
  })

  test('rejects stale service-component updates with optimistic-lock 409', async ({ request }) => {
    const stamp = uniqueSuffix()
    let componentId: string | null = null

    try {
      componentId = await createComponent(request, { key: `lock-${stamp}`, name: 'Lock component' })
      const before = await readComponent(request, componentId)
      const staleUpdatedAt = before?.updated_at
      expect(typeof staleUpdatedAt, 'component detail should expose updated_at for locking').toBe('string')

      await new Promise((resolve) => setTimeout(resolve, 10))
      const freshUpdate = await request.fetch(resolveApiUrl(COMPONENTS_API), {
        method: 'PUT',
        headers: authHeaders(token, staleUpdatedAt as string),
        data: { id: componentId, organizationId: scope.organizationId, tenantId: scope.tenantId, name: 'Lock component v2' },
      })
      expect(freshUpdate.status(), 'PUT with the current lock should succeed').toBe(200)

      const conflict = await request.fetch(resolveApiUrl(COMPONENTS_API), {
        method: 'PUT',
        headers: authHeaders(token, staleUpdatedAt as string),
        data: { id: componentId, organizationId: scope.organizationId, tenantId: scope.tenantId, name: 'Lock component v3' },
      })
      expect(conflict.status(), 'stale component PUT should be refused with 409').toBe(409)
      const conflictBody = await readJsonSafe<{ code?: string }>(conflict)
      expect(conflictBody?.code, 'stale component PUT should return optimistic-lock conflict code').toBe(OPTIMISTIC_LOCK_CONFLICT_CODE)
    } finally {
      await deleteComponentIfExists(request, componentId)
    }
  })
})
