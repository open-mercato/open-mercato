import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createCustomerRoleFixture,
  createCustomerUserFixture,
  deleteCustomerRoleFixture,
  deleteCustomerUserFixture,
  portalCookieHeaders,
  portalLogin,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import {
  createCompanyFixture,
  deleteEntityByBody,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import {
  OPTIMISTIC_LOCK_HEADER_NAME,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

export const integrationMeta = {
  dependsOnModules: ['incidents', 'customer_accounts', 'progress'],
}

const INCIDENTS_API = '/api/incidents'
const SEVERITIES_API = '/api/incidents/severities'
const BULK_QUEUE = 'incidents-bulk-ops'
const BASE_URL = process.env.BASE_URL?.trim() || ''

type Scope = {
  organizationId: string
  tenantId: string
}

type ListResponse<T> = {
  items?: T[]
}

type IncidentRecord = {
  id: string
  updated_at?: string | null
  acknowledged_at?: string | null
}

type SeverityRecord = {
  id: string
}

type PortalIncident = {
  id: string
  number: string
  title: string
  status: string
  updates: Array<{ id: string; body: string | null }>
} & Record<string, unknown>

type PortalResponse = {
  items?: PortalIncident[]
  total?: number
  ok?: boolean
  error?: string
}

type CommandResponse = {
  ok?: boolean
  impactId?: unknown
  entryId?: unknown
  progressJobId?: unknown
}

let token = ''
let scope: Scope
const createdIncidentIds = new Set<string>()

function resolveApiUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

function authHeaders(lockValue?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
  if (lockValue) headers[OPTIMISTIC_LOCK_HEADER_NAME] = lockValue
  return headers
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

async function fetchSeededSeverityId(request: APIRequestContext): Promise<string> {
  const response = await apiRequest(request, 'GET', `${SEVERITIES_API}?isActive=true&pageSize=100`, { token })
  expect(response.status(), 'seeded severities should be readable').toBe(200)
  const body = await readJsonSafe<ListResponse<SeverityRecord>>(response)
  const severity = itemsFrom(body).find((item) => typeof item.id === 'string' && item.id.length > 0)
  expect(severity, 'at least one seeded incident severity should exist').toBeTruthy()
  return severity!.id
}

async function createIncident(request: APIRequestContext, title = uniqueTitle('INC portal/bulk test')): Promise<string> {
  const response = await apiRequest(request, 'POST', INCIDENTS_API, {
    token,
    data: {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      title,
      description: 'Playwright portal/bulk integration fixture',
      severityId: await fetchSeededSeverityId(request),
    },
  })
  expect(response.status(), 'POST /api/incidents should create an incident').toBe(201)
  const body = await readJsonSafe<{ id?: unknown }>(response)
  const id = expectId(body?.id, 'created incident should return an id')
  createdIncidentIds.add(id)
  return id
}

async function readIncident(request: APIRequestContext, id: string): Promise<IncidentRecord> {
  const response = await apiRequest(request, 'GET', `${INCIDENTS_API}?id=${encodeURIComponent(id)}`, { token })
  expect(response.status(), 'GET /api/incidents?id=... should succeed').toBe(200)
  const body = await readJsonSafe<ListResponse<IncidentRecord>>(response)
  const item = itemsFrom(body).find((record) => record.id === id)
  expect(item, `incident ${id} should be returned by detail GET`).toBeTruthy()
  return item!
}

async function deleteIncidentIfExists(request: APIRequestContext, id: string | null): Promise<void> {
  if (!token || !id) return
  try {
    await apiRequest(request, 'DELETE', `${INCIDENTS_API}?id=${encodeURIComponent(id)}`, { token })
  } catch {
    // Cleanup must not mask the assertion that already failed.
  } finally {
    createdIncidentIds.delete(id)
  }
}

async function fetchWithCurrentIncidentLock(
  request: APIRequestContext,
  incidentId: string,
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  data: Record<string, unknown> = {},
): Promise<{ status: number; body: CommandResponse | null }> {
  const incident = await readIncident(request, incidentId)
  expect(typeof incident.updated_at, 'incident detail should expose updated_at for aggregate locking').toBe('string')
  const response = await request.fetch(resolveApiUrl(path), {
    method,
    headers: authHeaders(incident.updated_at as string),
    data,
  })
  return { status: response.status(), body: await readJsonSafe<CommandResponse>(response) }
}

async function addCustomerAccountImpact(
  request: APIRequestContext,
  incidentId: string,
  customerAccountId: string,
  label: string,
): Promise<void> {
  const response = await fetchWithCurrentIncidentLock(request, incidentId, 'POST', `${INCIDENTS_API}/${incidentId}/impacts`, {
    targetType: 'customer_account',
    targetId: customerAccountId,
    impactStatus: 'degraded',
    snapshot: { label },
  })
  expect([200, 201], 'customer-account impact should be created').toContain(response.status)
  expectId(response.body?.impactId, 'customer-account impact response should return impactId')
}

async function addTimeline(
  request: APIRequestContext,
  incidentId: string,
  body: string,
  visibility: 'internal' | 'customer_facing',
): Promise<void> {
  const response = await fetchWithCurrentIncidentLock(request, incidentId, 'POST', `${INCIDENTS_API}/${incidentId}/timeline`, {
    kind: visibility === 'customer_facing' ? 'update' : 'note',
    body,
    visibility,
  })
  expect(response.status, `${visibility} timeline entry should be created`).toBe(200)
  expectId(response.body?.entryId, 'timeline response should return entryId')
}

async function waitForAcknowledged(request: APIRequestContext, ids: string[]): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const details = await Promise.all(ids.map((id) => readIncident(request, id)))
    if (details.every((item) => typeof item.acknowledged_at === 'string')) return
    await drainIntegrationQueue(BULK_QUEUE, { jobLimit: 20 }).catch(() => 0)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  const details = await Promise.all(ids.map((id) => readIncident(request, id)))
  expect(
    details.map((item) => item.acknowledged_at),
    'bulk acknowledge should set acknowledged_at on all valid incidents',
  ).toEqual(ids.map(() => expect.any(String)))
}

test.describe('TC-INC-009: Incident portal and bulk APIs', () => {
  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin')
    scope = getTokenContext(token)
  })

  test.afterAll(async ({ request }) => {
    for (const id of Array.from(createdIncidentIds)) {
      await deleteIncidentIfExists(request, id)
    }
  })

  test('portal list is account-scoped, customer-facing only, and rejects anonymous callers', async ({ request }) => {
    let roleId: string | null = null
    let userAId: string | null = null
    let userBId: string | null = null
    let companyAId: string | null = null
    let companyBId: string | null = null
    let incidentAId: string | null = null
    let incidentBId: string | null = null
    let incidentCId: string | null = null

    try {
      const anonymous = await request.get('/api/incidents/portal')
      expect(anonymous.status(), 'portal incidents should reject anonymous callers').toBe(401)

      const role = await createCustomerRoleFixture(request, token, {
        features: ['portal.incidents.view'],
      })
      roleId = role.id
      companyAId = await createCompanyFixture(request, token, uniqueTitle('Portal company A'))
      companyBId = await createCompanyFixture(request, token, uniqueTitle('Portal company B'))
      const userA = await createCustomerUserFixture(request, token, {
        roleIds: [role.id],
        customerEntityId: companyAId,
      })
      const userB = await createCustomerUserFixture(request, token, {
        roleIds: [role.id],
        customerEntityId: companyBId,
      })
      userAId = userA.id
      userBId = userB.id

      incidentAId = await createIncident(request, uniqueTitle('INC portal account A'))
      incidentBId = await createIncident(request, uniqueTitle('INC portal account B'))
      incidentCId = await createIncident(request, uniqueTitle('INC portal no account'))

      await addCustomerAccountImpact(request, incidentAId, companyAId, 'Portal account A')
      await addCustomerAccountImpact(request, incidentBId, companyBId, 'Portal account B')

      const customerUpdate = `customer-facing update ${uniqueSuffix()}`
      const internalNote = `internal note ${uniqueSuffix()}`
      await addTimeline(request, incidentAId, customerUpdate, 'customer_facing')
      await addTimeline(request, incidentAId, internalNote, 'internal')

      const sessionA = await portalLogin(request, {
        email: userA.email,
        password: userA.password,
        tenantId: scope.tenantId,
      })
      const response = await request.get('/api/incidents/portal?pageSize=50', {
        headers: portalCookieHeaders(sessionA),
      })
      expect(response.status(), 'portal incident list should succeed').toBe(200)
      const body = await readJsonSafe<PortalResponse>(response)
      const items = body?.items ?? []
      const itemIds = new Set(items.map((item) => item.id))
      expect(itemIds.has(incidentAId), 'P1 should see its impacted incident').toBe(true)
      expect(itemIds.has(incidentBId), 'P1 should not see another account incident').toBe(false)
      expect(itemIds.has(incidentCId), 'P1 should not see incidents without a customer-account impact').toBe(false)

      const incidentA = items.find((item) => item.id === incidentAId)
      expect(incidentA, 'P1 response should include incident A').toBeTruthy()
      const updateBodies = (incidentA?.updates ?? []).map((update) => update.body)
      expect(updateBodies, 'portal updates should include the customer-facing update').toContain(customerUpdate)
      expect(updateBodies, 'portal updates must not include internal notes').not.toContain(internalNote)

      for (const forbiddenKey of [
        'revenueAtRiskMinor',
        'revenueAtRiskCurrency',
        'revenue_at_risk_minor',
        'revenue_at_risk_currency',
        'escalationStatus',
        'escalation_status',
        'ownerUserId',
        'owner_user_id',
      ]) {
        expect(Object.prototype.hasOwnProperty.call(incidentA!, forbiddenKey), `${forbiddenKey} must not leak to portal`).toBe(false)
      }
    } finally {
      await deleteIncidentIfExists(request, incidentAId)
      await deleteIncidentIfExists(request, incidentBId)
      await deleteIncidentIfExists(request, incidentCId)
      await deleteCustomerUserFixture(request, token, userAId)
      await deleteCustomerUserFixture(request, token, userBId)
      await deleteCustomerRoleFixture(request, token, roleId)
      await deleteEntityByBody(request, token, '/api/customers/companies', companyAId)
      await deleteEntityByBody(request, token, '/api/customers/companies', companyBId)
    }
  })

  test('bulk acknowledge queues work, processes valid ids despite one missing id, and is RBAC-gated', async ({ request }) => {
    let incidentOneId: string | null = null
    let incidentTwoId: string | null = null
    let roleId: string | null = null
    let limitedUserId: string | null = null
    let limitedToken: string | null = null

    try {
      incidentOneId = await createIncident(request, uniqueTitle('INC bulk one'))
      incidentTwoId = await createIncident(request, uniqueTitle('INC bulk two'))
      const missingId = randomUUID()

      const response = await apiRequest(request, 'POST', `${INCIDENTS_API}/bulk`, {
        token,
        data: { action: 'acknowledge', ids: [incidentOneId, incidentTwoId, missingId] },
      })
      expect(response.status(), 'bulk acknowledge should return 202').toBe(202)
      const body = await readJsonSafe<CommandResponse>(response)
      expect(body?.ok, 'bulk acknowledge should return ok').toBe(true)
      expectId(body?.progressJobId, 'bulk acknowledge should return progressJobId')

      await drainIntegrationQueue(BULK_QUEUE, { jobLimit: 20 }).catch(() => 0)
      await waitForAcknowledged(request, [incidentOneId, incidentTwoId])

      const stamp = uniqueSuffix()
      const password = 'Incident-Bulk-1!'
      roleId = await createRoleFixture(request, token, {
        name: `qa_incidents_bulk_${stamp}`,
        tenantId: scope.tenantId,
      })
      await setRoleAclFeatures(request, token, { roleId, features: ['incidents.incident.view'] })
      limitedUserId = await createUserFixture(request, token, {
        email: `qa-incidents-bulk-${stamp}@acme.com`,
        password,
        organizationId: scope.organizationId,
        roles: [roleId],
        name: 'QA Incidents Bulk View-Only User',
      })
      limitedToken = await getAuthToken(request, `qa-incidents-bulk-${stamp}@acme.com`, password)

      const denied = await apiRequest(request, 'POST', `${INCIDENTS_API}/bulk`, {
        token: limitedToken,
        data: { action: 'acknowledge', ids: [randomUUID()] },
      })
      expect(denied.status(), 'bulk without incidents.incident.manage should return 403').toBe(403)
    } finally {
      await deleteIncidentIfExists(request, incidentOneId)
      await deleteIncidentIfExists(request, incidentTwoId)
      await deleteUserIfExists(request, token, limitedUserId)
      await deleteRoleIfExists(request, token, roleId)
    }
  })
})
