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
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['incidents'],
}

const INCIDENTS_API = '/api/incidents'
const SEVERITIES_API = '/api/incidents/severities'
const RUNBOOKS_API = '/api/incidents/runbooks'
const RUNBOOK_STEPS_API = '/api/incidents/runbook-steps'
const TEST_PASSWORD = 'Incident-Runbook-1!'

type Scope = {
  organizationId: string
  tenantId: string
}

type InstantiateResponse = {
  ok?: boolean
  runbookId?: string | null
  createdActionItemIds?: string[]
  skippedActionItemIds?: string[]
}

let token = ''
let scope: Scope
const createdRunbookIds = new Set<string>()
const createdStepIds = new Set<string>()
const createdIncidentIds = new Set<string>()

function uniqueSuffix(): string {
  return `${Date.now()}-${randomUUID().slice(0, 8)}`
}

function itemsFrom<T>(body: { items?: T[] } | null): T[] {
  return Array.isArray(body?.items) ? body.items : []
}

async function fetchSeverityId(request: APIRequestContext): Promise<string> {
  const response = await apiRequest(request, 'GET', `${SEVERITIES_API}?isActive=true&pageSize=100`, { token })
  expect(response.status(), 'GET /api/incidents/severities should succeed').toBe(200)
  const body = await readJsonSafe<{ items?: Array<{ id: string }> }>(response)
  const severity = itemsFrom(body).find((item) => typeof item.id === 'string' && item.id.length > 0)
  expect(severity, 'at least one active severity should exist').toBeTruthy()
  return severity!.id
}

async function createRunbook(request: APIRequestContext, key: string, name: string): Promise<string> {
  const response = await apiRequest(request, 'POST', RUNBOOKS_API, {
    token,
    data: { organizationId: scope.organizationId, tenantId: scope.tenantId, key, name },
  })
  expect(response.status(), 'POST /api/incidents/runbooks should create a runbook').toBe(201)
  const body = await readJsonSafe<{ id?: unknown }>(response)
  const id = expectId(body?.id, 'runbook creation response should include id')
  createdRunbookIds.add(id)
  return id
}

async function createRunbookStep(
  request: APIRequestContext,
  input: { runbookId: string; position: number; title: string },
): Promise<string> {
  const response = await apiRequest(request, 'POST', RUNBOOK_STEPS_API, {
    token,
    data: {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      runbookId: input.runbookId,
      position: input.position,
      title: input.title,
    },
  })
  expect(response.status(), 'POST /api/incidents/runbook-steps should create a step').toBe(201)
  const body = await readJsonSafe<{ id?: unknown }>(response)
  const id = expectId(body?.id, 'runbook step creation response should include id')
  createdStepIds.add(id)
  return id
}

async function createIncident(request: APIRequestContext): Promise<string> {
  const response = await apiRequest(request, 'POST', INCIDENTS_API, {
    token,
    data: {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      title: `INC runbook instantiate ${uniqueSuffix()}`,
      description: 'Playwright runbook instantiate fixture',
      severityId: await fetchSeverityId(request),
    },
  })
  expect(response.status(), 'POST /api/incidents should create an incident').toBe(201)
  const body = await readJsonSafe<{ id?: unknown }>(response)
  const id = expectId(body?.id, 'created incident should return id')
  createdIncidentIds.add(id)
  return id
}

async function instantiate(
  request: APIRequestContext,
  incidentId: string,
  runbookId: string | null,
  authToken = token,
): Promise<{ status: number; body: InstantiateResponse | null }> {
  const response = await apiRequest(request, 'POST', `${INCIDENTS_API}/${encodeURIComponent(incidentId)}/runbook/instantiate`, {
    token: authToken,
    data: { organizationId: scope.organizationId, tenantId: scope.tenantId, runbookId },
  })
  const body = response.ok() ? await readJsonSafe<InstantiateResponse>(response) : null
  return { status: response.status(), body }
}

async function deleteIfExists(request: APIRequestContext, path: string, id: string | null, tracker: Set<string>, authToken = token): Promise<void> {
  if (!authToken || !id) return
  try {
    await apiRequest(request, 'DELETE', `${path}?id=${encodeURIComponent(id)}`, { token: authToken })
  } catch {
    // Cleanup must not mask the primary assertion failure.
  } finally {
    tracker.delete(id)
  }
}

async function setRoleAclFeaturesForTenant(
  request: APIRequestContext,
  authToken: string,
  input: { roleId: string; tenantId: string; features: string[] },
): Promise<void> {
  const response = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
    token: authToken,
    data: { roleId: input.roleId, tenantId: input.tenantId, features: input.features, organizations: null },
  })
  expect(response.status(), 'PUT /api/auth/roles/acl should return 200').toBe(200)
}

test.describe('TC-INC-022: Incident runbook instantiation', () => {
  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin')
    scope = getTokenContext(token)
  })

  test.afterAll(async ({ request }) => {
    for (const id of Array.from(createdStepIds)) await deleteIfExists(request, RUNBOOK_STEPS_API, id, createdStepIds)
    for (const id of Array.from(createdRunbookIds)) await deleteIfExists(request, RUNBOOKS_API, id, createdRunbookIds)
    for (const id of Array.from(createdIncidentIds)) await deleteIfExists(request, INCIDENTS_API, id, createdIncidentIds)
  })

  test('creates action items from active steps and is idempotent on re-run', async ({ request }) => {
    const stamp = uniqueSuffix()
    let runbookId: string | null = null
    let incidentId: string | null = null
    const stepIds: string[] = []

    try {
      runbookId = await createRunbook(request, `rb-${stamp}`, 'Major incident response')
      stepIds.push(await createRunbookStep(request, { runbookId, position: 0, title: 'Assemble the response team' }))
      stepIds.push(await createRunbookStep(request, { runbookId, position: 1, title: 'Open the customer status update' }))
      incidentId = await createIncident(request)

      const first = await instantiate(request, incidentId, runbookId)
      expect(first.status, 'first instantiate should succeed').toBe(200)
      expect(first.body?.runbookId, 'response should echo the resolved runbook id').toBe(runbookId)
      expect(first.body?.createdActionItemIds?.length, 'first instantiate should create one action item per active step').toBe(2)
      expect(first.body?.skippedActionItemIds?.length ?? 0, 'first instantiate should skip nothing').toBe(0)

      const second = await instantiate(request, incidentId, runbookId)
      expect(second.status, 'second instantiate should succeed').toBe(200)
      expect(second.body?.createdActionItemIds?.length ?? 0, 'idempotent re-run must not create duplicate action items').toBe(0)
      expect(second.body?.skippedActionItemIds?.length, 'idempotent re-run should report the pre-existing items as skipped').toBe(2)
    } finally {
      for (const id of stepIds) await deleteIfExists(request, RUNBOOK_STEPS_API, id, createdStepIds)
      await deleteIfExists(request, RUNBOOKS_API, runbookId, createdRunbookIds)
      await deleteIfExists(request, INCIDENTS_API, incidentId, createdIncidentIds)
    }
  })

  test('returns 404 when instantiating against an incident outside the scope', async ({ request }) => {
    const stamp = uniqueSuffix()
    let runbookId: string | null = null

    try {
      runbookId = await createRunbook(request, `rb-missing-${stamp}`, 'Orphan runbook')
      const response = await apiRequest(
        request,
        'POST',
        `${INCIDENTS_API}/${randomUUID()}/runbook/instantiate`,
        { token, data: { organizationId: scope.organizationId, tenantId: scope.tenantId, runbookId } },
      )
      expect(response.status(), 'instantiate against an unknown incident should 404').toBe(404)
    } finally {
      await deleteIfExists(request, RUNBOOKS_API, runbookId, createdRunbookIds)
    }
  })

  test('requires incidents.incident.manage to instantiate a runbook', async ({ request }) => {
    const stamp = uniqueSuffix()
    const roleName = `qa_inc_rb_view_${stamp}`
    const email = `qa-inc-rb-view-${stamp}@acme.com`
    let runbookId: string | null = null
    let incidentId: string | null = null
    let roleId: string | null = null
    let userId: string | null = null

    try {
      runbookId = await createRunbook(request, `rb-rbac-${stamp}`, 'RBAC runbook')
      await createRunbookStep(request, { runbookId, position: 0, title: 'Step one' })
      incidentId = await createIncident(request)

      roleId = await createRoleFixture(request, token, { name: roleName, tenantId: scope.tenantId })
      await setRoleAclFeaturesForTenant(request, token, {
        roleId,
        tenantId: scope.tenantId,
        features: ['incidents.incident.view'],
      })
      userId = await createUserFixture(request, token, {
        email,
        password: TEST_PASSWORD,
        organizationId: scope.organizationId,
        roles: [roleId],
        name: 'QA Incidents Runbook Viewer',
      })
      const viewerToken = await getAuthToken(request, email, TEST_PASSWORD)

      const denied = await instantiate(request, incidentId, runbookId, viewerToken)
      expect(denied.status, 'viewer without incidents.incident.manage must receive 403').toBe(403)
    } finally {
      await deleteUserIfExists(request, token, userId)
      await deleteRoleIfExists(request, token, roleId)
      await deleteIfExists(request, INCIDENTS_API, incidentId, createdIncidentIds)
      await deleteIfExists(request, RUNBOOKS_API, runbookId, createdRunbookIds)
    }
  })
})
