import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
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
const ROLES_API = '/api/incidents/roles'
const ESCALATION_POLICIES_API = '/api/incidents/escalation-policies'

type Scope = {
  organizationId: string
  tenantId: string
  userId?: string
  sub?: string
}

type ListResponse<T> = {
  items?: T[]
}

type IncidentRecord = {
  id: string
  owner_user_id?: string | null
  escalation_status?: string | null
  escalation_level?: number | null
  next_escalation_at?: string | null
  acknowledged_at?: string | null
}

type SeverityRecord = {
  id: string
}

type RoleRecord = {
  id: string
  key?: string | null
  is_active?: boolean | null
}

type EscalationTarget = {
  type: string
  id: string
  label?: string | null
}

type EscalationPreviewResponse = {
  nextLevel?: unknown
  stepCount?: unknown
  willExhaust?: unknown
  targets?: unknown
  recipients?: unknown
}

type EscalateResponse = {
  escalationLevel?: unknown
  escalationStepCount?: unknown
  escalationStatus?: unknown
  nextEscalationAt?: unknown
  pagedTargets?: unknown
}

type EscalationPolicyRecord = {
  id: string
  key?: string | null
  name?: string | null
  steps?: EscalationStep[] | null
  repeat_count?: number | null
  is_default?: boolean | null
}

type EscalationStep = {
  delayMinutes?: number | null
  targets?: EscalationTarget[] | null
}

type ErrorBody = {
  error?: unknown
  code?: unknown
}

let token = ''
let scope: Scope
const createdIncidentIds = new Set<string>()
const createdPolicyIds = new Set<string>()

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function uniqueTitle(prefix: string): string {
  return `${prefix} ${uniqueSuffix()}`
}

function itemsFrom<T>(body: ListResponse<T> | null): T[] {
  return Array.isArray(body?.items) ? body.items : []
}

function resolveAdminUserId(): string | null {
  const userId = typeof scope.userId === 'string' && scope.userId.length > 0 ? scope.userId : null
  const sub = typeof scope.sub === 'string' && scope.sub.length > 0 ? scope.sub : null
  if (userId ?? sub) return userId ?? sub

  const payloadPart = token.split('.')[1]
  if (!payloadPart) return null
  try {
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString()) as {
      sub?: unknown
      userId?: unknown
    }
    if (typeof payload.userId === 'string' && payload.userId.length > 0) return payload.userId
    if (typeof payload.sub === 'string' && payload.sub.length > 0) return payload.sub
  } catch {
    return null
  }
  return null
}

function expectIsoString(value: unknown, message: string): string {
  expect(typeof value, message).toBe('string')
  const raw = value as string
  expect(raw, message).toMatch(/^\d{4}-\d{2}-\d{2}[T ]/)
  expect(Number.isNaN(Date.parse(raw)), message).toBe(false)
  return raw
}

function errorText(body: ErrorBody | null): string {
  const parts = [body?.error, body?.code].filter((value): value is string => typeof value === 'string')
  return parts.join(' ')
}

async function fetchSeededSeverityId(request: APIRequestContext): Promise<string> {
  const response = await apiRequest(request, 'GET', `${SEVERITIES_API}?isActive=true&pageSize=100`, { token })
  expect(response.status(), 'seeded severities should be readable').toBe(200)
  const body = await readJsonSafe<ListResponse<SeverityRecord>>(response)
  const severity = itemsFrom(body).find((item) => typeof item.id === 'string' && item.id.length > 0)
  expect(severity, 'at least one seeded incident severity should exist').toBeTruthy()
  return severity!.id
}

async function fetchSeededRoleId(request: APIRequestContext): Promise<string> {
  const response = await apiRequest(request, 'GET', `${ROLES_API}?isActive=true&pageSize=100`, { token })
  expect(response.status(), 'seeded incident roles should be readable').toBe(200)
  const body = await readJsonSafe<ListResponse<RoleRecord>>(response)
  const role = itemsFrom(body).find((item) => typeof item.id === 'string' && item.id.length > 0)
  expect(role, 'at least one seeded incident role should exist').toBeTruthy()
  return role!.id
}

async function createIncident(
  request: APIRequestContext,
  input: { title?: string; severityId?: string; ownerUserId?: string | null } = {},
): Promise<string> {
  const severityId = input.severityId ?? await fetchSeededSeverityId(request)
  const data: Record<string, unknown> = {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    title: input.title ?? uniqueTitle('INC escalation test'),
    description: 'Playwright escalation integration fixture',
    severityId,
  }
  if (input.ownerUserId) data.ownerUserId = input.ownerUserId

  const response = await apiRequest(request, 'POST', INCIDENTS_API, { token, data })
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

async function deletePolicyIfExists(request: APIRequestContext, id: string | null): Promise<void> {
  if (!token || !id) return
  try {
    await apiRequest(request, 'DELETE', `${ESCALATION_POLICIES_API}?id=${encodeURIComponent(id)}`, { token })
  } catch {
    // Cleanup must not mask the assertion that already failed.
  } finally {
    createdPolicyIds.delete(id)
  }
}

test.describe('TC-INC-005: Incident escalation policy model', () => {
  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin')
    scope = getTokenContext(token) as Scope
  })

  test.afterAll(async ({ request }) => {
    for (const id of Array.from(createdIncidentIds)) {
      await deleteIncidentIfExists(request, id)
    }
    for (const id of Array.from(createdPolicyIds)) {
      await deletePolicyIfExists(request, id)
    }
  })

  test('declare starts escalation', async ({ request }) => {
    let incidentId: string | null = null
    try {
      const adminUserId = resolveAdminUserId()
      incidentId = await createIncident(request, { ownerUserId: adminUserId })

      const detail = await readIncident(request, incidentId)
      if (adminUserId) expect(detail.owner_user_id, 'incident owner should be the admin user').toBe(adminUserId)
      expect(detail.escalation_status, 'default policy should start escalation on declare').toBe('active')
      expect(detail.escalation_level, 'declared incidents start at escalation level 0').toBe(0)
      expectIsoString(detail.next_escalation_at, 'next_escalation_at should be a non-null ISO string')
    } finally {
      await deleteIncidentIfExists(request, incidentId)
    }
  })

  test('preview returns next step', async ({ request }) => {
    let incidentId: string | null = null
    try {
      incidentId = await createIncident(request)

      const response = await apiRequest(request, 'GET', `${INCIDENTS_API}/${incidentId}/escalate/preview`, { token })
      expect(response.status(), 'escalation preview should succeed').toBe(200)
      const body = await readJsonSafe<EscalationPreviewResponse>(response)
      expect(typeof body?.nextLevel, 'preview should include numeric nextLevel').toBe('number')
      expect(typeof body?.stepCount, 'preview should include numeric stepCount').toBe('number')
      expect(body?.stepCount as number, 'preview stepCount should be at least one').toBeGreaterThanOrEqual(1)
      expect(typeof body?.willExhaust, 'preview should include boolean willExhaust').toBe('boolean')
      expect(Array.isArray(body?.targets), 'preview should include targets array').toBe(true)
      expect(Array.isArray(body?.recipients), 'preview should include recipients array').toBe(true)
    } finally {
      await deleteIncidentIfExists(request, incidentId)
    }
  })

  test('manual escalate advances exactly one step and returns a rich body', async ({ request }) => {
    let incidentId: string | null = null
    try {
      incidentId = await createIncident(request)
      const before = await readIncident(request, incidentId)
      expect(before.escalation_level, 'incident should start at escalation level 0 before manual escalation').toBe(0)

      const response = await apiRequest(request, 'POST', `${INCIDENTS_API}/${incidentId}/escalate`, {
        token,
        data: {},
      })
      expect(response.status(), 'manual escalate should succeed').toBe(200)
      const body = await readJsonSafe<EscalateResponse>(response)
      expect(typeof body?.escalationLevel, 'escalate body should include escalationLevel').toBe('number')
      expect(typeof body?.escalationStepCount, 'escalate body should include escalationStepCount').toBe('number')
      expect(typeof body?.escalationStatus, 'escalate body should include escalationStatus').toBe('string')
      expect(body?.nextEscalationAt === null || typeof body?.nextEscalationAt === 'string', 'escalate body should include nextEscalationAt').toBe(true)
      expect(Array.isArray(body?.pagedTargets), 'escalate body should include pagedTargets array').toBe(true)
      expect(body?.escalationLevel, 'manual escalate should advance exactly one step').toBe((before.escalation_level ?? 0) + 1)

      const after = await readIncident(request, incidentId)
      expect(after.escalation_level, 'manual escalation level should persist').toBe(body?.escalationLevel)
    } finally {
      await deleteIncidentIfExists(request, incidentId)
    }
  })

  test('ack halts escalation', async ({ request }) => {
    let incidentId: string | null = null
    try {
      incidentId = await createIncident(request)

      const response = await apiRequest(request, 'POST', `${INCIDENTS_API}/${incidentId}/acknowledge`, {
        token,
        data: {},
      })
      expect(response.status(), 'acknowledge should succeed').toBe(200)

      const detail = await readIncident(request, incidentId)
      expect(typeof detail.acknowledged_at, 'acknowledged_at should be set').toBe('string')
      expect(detail.escalation_status, 'acknowledge should halt active escalation').toBe('acknowledged')
      expect(detail.next_escalation_at, 'acknowledge should clear next_escalation_at').toBeNull()
    } finally {
      await deleteIncidentIfExists(request, incidentId)
    }
  })

  test('bounded escalation eventually exhausts', async ({ request }) => {
    let incidentId: string | null = null
    try {
      incidentId = await createIncident(request)
      let sawExhausted = false

      for (let attempt = 0; attempt < 8; attempt += 1) {
        const response = await apiRequest(request, 'POST', `${INCIDENTS_API}/${incidentId}/escalate`, {
          token,
          data: {},
        })
        expect(response.status(), `manual escalate attempt ${attempt + 1} should succeed until exhaustion is observed`).toBe(200)
        const body = await readJsonSafe<EscalateResponse>(response)
        expect(typeof body?.escalationStatus, 'escalate body should include escalationStatus').toBe('string')
        if (body?.escalationStatus === 'exhausted') {
          sawExhausted = true
          break
        }
      }

      expect(sawExhausted, 'escalation should exhaust within the bounded loop').toBe(true)
      const exhaustedAgain = await apiRequest(request, 'POST', `${INCIDENTS_API}/${incidentId}/escalate`, {
        token,
        data: {},
      })
      expect(exhaustedAgain.status(), 'subsequent escalate after exhaustion should return 409').toBe(409)
      const body = await readJsonSafe<ErrorBody>(exhaustedAgain)
      expect(errorText(body), 'exhausted response should name escalation_exhausted').toContain('escalation_exhausted')
    } finally {
      await deleteIncidentIfExists(request, incidentId)
    }
  })

  test('escalation-policy CRUD', async ({ request }) => {
    const key = `test-${uniqueSuffix()}`
    let policyId: string | null = null
    try {
      const listResponse = await apiRequest(request, 'GET', `${ESCALATION_POLICIES_API}?pageSize=100`, { token })
      expect(listResponse.status(), 'GET /api/incidents/escalation-policies should succeed').toBe(200)
      const list = await readJsonSafe<ListResponse<EscalationPolicyRecord>>(listResponse)
      const defaultPolicy = itemsFrom(list).find((policy) => policy.key === 'default')
      expect(defaultPolicy, 'seeded default escalation policy should be present').toBeTruthy()
      expect(Array.isArray(defaultPolicy?.steps), 'default policy should expose steps').toBe(true)
      expect(defaultPolicy?.steps?.length ?? 0, 'default policy steps should be non-empty').toBeGreaterThan(0)
      expect(defaultPolicy?.is_default, 'default policy should be marked as default').toBe(true)

      const roleId = await fetchSeededRoleId(request)
      const createResponse = await apiRequest(request, 'POST', ESCALATION_POLICIES_API, {
        token,
        data: {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          key,
          name: `Test escalation policy ${uniqueSuffix()}`,
          steps: [{ delayMinutes: 5, targets: [{ type: 'role', id: roleId }] }],
          repeatCount: 0,
        },
      })
      expect(createResponse.status(), 'POST /api/incidents/escalation-policies should create a policy').toBe(201)
      const created = await readJsonSafe<{ id?: unknown }>(createResponse)
      policyId = expectId(created?.id, 'created escalation policy should return an id')
      createdPolicyIds.add(policyId)

      const detailResponse = await apiRequest(request, 'GET', `${ESCALATION_POLICIES_API}?id=${encodeURIComponent(policyId)}`, { token })
      expect(detailResponse.status(), 'GET /api/incidents/escalation-policies?id=... should succeed').toBe(200)
      const detail = await readJsonSafe<ListResponse<EscalationPolicyRecord>>(detailResponse)
      const policy = itemsFrom(detail).find((item) => item.id === policyId)
      expect(policy, 'created policy should be returned by id lookup').toBeTruthy()
      expect(policy?.key, 'created policy key should persist').toBe(key)
      expect(policy?.steps?.[0]?.targets?.[0]?.id, 'created policy target role should persist').toBe(roleId)

      const deleteResponse = await apiRequest(request, 'DELETE', `${ESCALATION_POLICIES_API}?id=${encodeURIComponent(policyId)}`, { token })
      expect(deleteResponse.status(), 'DELETE /api/incidents/escalation-policies should delete the policy').toBe(200)
      createdPolicyIds.delete(policyId)
      policyId = null
    } finally {
      await deletePolicyIfExists(request, policyId)
    }
  })
})
