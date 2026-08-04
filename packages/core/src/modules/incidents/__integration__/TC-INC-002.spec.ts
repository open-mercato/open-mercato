import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  expectId,
  getTokenContext,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['incidents'],
}

const INCIDENTS_API = '/api/incidents'
const SEVERITIES_API = '/api/incidents/severities'
const TYPES_API = '/api/incidents/types'

type Scope = {
  organizationId: string
  tenantId: string
}

type ListResponse<T> = {
  items?: T[]
}

type IncidentRecord = {
  id: string
  status?: string | null
  severity_id?: string | null
  owner_user_id?: string | null
  acknowledged_at?: string | null
  resolved_at?: string | null
  escalation_level?: number | null
  snoozed_until?: string | null
  next_escalation_at?: string | null
}

type SeverityRecord = {
  id: string
  key?: string | null
}

type IncidentTypeRecord = {
  id: string
  key?: string | null
  required_fields_on_resolve?: string[] | null
}

let token = ''
let scope: Scope
let userId = ''
const createdIncidentIds = new Set<string>()

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function uniqueTitle(prefix: string): string {
  return `${prefix} ${uniqueSuffix()}`
}

function itemsFrom<T>(body: ListResponse<T> | null): T[] {
  return Array.isArray(body?.items) ? body.items : []
}

async function listSeverities(request: APIRequestContext): Promise<SeverityRecord[]> {
  const response = await apiRequest(request, 'GET', `${SEVERITIES_API}?isActive=true&pageSize=100`, { token })
  expect(response.status(), 'seeded severities should be readable').toBe(200)
  const body = await readJsonSafe<ListResponse<SeverityRecord>>(response)
  const items = itemsFrom(body)
  expect(items.length, 'at least one seeded incident severity should exist').toBeGreaterThan(0)
  return items
}

async function fetchSeededSeverityId(request: APIRequestContext): Promise<string> {
  return (await listSeverities(request))[0].id
}

async function fetchDifferentSeverityId(request: APIRequestContext, currentSeverityId: string): Promise<string> {
  const different = (await listSeverities(request)).find((severity) => severity.id !== currentSeverityId)
  expect(different, 'at least two seeded incident severities should exist').toBeTruthy()
  return different!.id
}

async function fetchTypeRequiringRootCause(request: APIRequestContext): Promise<string> {
  const response = await apiRequest(request, 'GET', `${TYPES_API}?isActive=true&pageSize=100`, { token })
  expect(response.status(), 'seeded incident types should be readable').toBe(200)
  const body = await readJsonSafe<ListResponse<IncidentTypeRecord>>(response)
  const type = itemsFrom(body).find((item) =>
    Array.isArray(item.required_fields_on_resolve) &&
    item.required_fields_on_resolve.includes('root_cause'),
  )
  expect(type, 'a seeded incident type requiring root_cause should exist').toBeTruthy()
  return type!.id
}

async function createIncident(
  request: APIRequestContext,
  input: { title?: string; severityId?: string; incidentTypeId?: string } = {},
): Promise<string> {
  const severityId = input.severityId ?? await fetchSeededSeverityId(request)
  const data: Record<string, unknown> = {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    title: input.title ?? uniqueTitle('INC lifecycle test'),
    description: 'Playwright lifecycle integration fixture',
    severityId,
  }
  if (input.incidentTypeId) data.incidentTypeId = input.incidentTypeId

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

test.describe('TC-INC-002: Incident lifecycle actions', () => {
  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin')
    scope = getTokenContext(token)
    userId = getTokenScope(token).userId
  })

  test.afterAll(async ({ request }) => {
    for (const id of Array.from(createdIncidentIds)) {
      await deleteIncidentIfExists(request, id)
    }
  })

  test('acknowledge sets acknowledged_at', async ({ request }) => {
    let incidentId: string | null = null
    try {
      incidentId = await createIncident(request)
      const response = await apiRequest(request, 'POST', `${INCIDENTS_API}/${incidentId}/acknowledge`, { token })
      expect(response.status(), 'acknowledge should succeed').toBe(200)

      const detail = await readIncident(request, incidentId)
      expect(typeof detail.acknowledged_at, 'acknowledged_at should be set').toBe('string')
    } finally {
      await deleteIncidentIfExists(request, incidentId)
    }
  })

  test('valid transition moves open incidents to investigating', async ({ request }) => {
    let incidentId: string | null = null
    try {
      incidentId = await createIncident(request)
      const response = await apiRequest(request, 'POST', `${INCIDENTS_API}/${incidentId}/transition`, {
        token,
        data: { status: 'investigating' },
      })
      expect(response.status(), 'open -> investigating should succeed').toBe(200)

      const detail = await readIncident(request, incidentId)
      expect(detail.status, 'incident status should be investigating').toBe('investigating')
    } finally {
      await deleteIncidentIfExists(request, incidentId)
    }
  })

  test('invalid transition returns 400', async ({ request }) => {
    let incidentId: string | null = null
    try {
      incidentId = await createIncident(request)
      const valid = await apiRequest(request, 'POST', `${INCIDENTS_API}/${incidentId}/transition`, {
        token,
        data: { status: 'investigating' },
      })
      expect(valid.status(), 'open -> investigating setup transition should succeed').toBe(200)

      const invalid = await apiRequest(request, 'POST', `${INCIDENTS_API}/${incidentId}/transition`, {
        token,
        data: { status: 'open' },
      })
      expect(invalid.status(), 'investigating -> open is not allowed').toBe(400)
    } finally {
      await deleteIncidentIfExists(request, incidentId)
    }
  })

  test('resolve requires root_cause for configured types and clears live timers on success', async ({ request }) => {
    let incidentId: string | null = null
    try {
      const incidentTypeId = await fetchTypeRequiringRootCause(request)
      incidentId = await createIncident(request, { incidentTypeId })

      const until = new Date(Date.now() + 60 * 60 * 1000).toISOString()
      const snooze = await apiRequest(request, 'POST', `${INCIDENTS_API}/${incidentId}/snooze`, {
        token,
        data: { until },
      })
      expect(snooze.status(), 'snooze setup should succeed').toBe(200)
      expect(typeof (await readIncident(request, incidentId)).snoozed_until, 'snooze setup should set snoozed_until').toBe('string')

      const missing = await apiRequest(request, 'POST', `${INCIDENTS_API}/${incidentId}/transition`, {
        token,
        data: { status: 'resolved' },
      })
      expect(missing.status(), 'resolving without root_cause should fail').toBe(400)
      const missingBody = await readJsonSafe<{ fields?: Record<string, unknown> }>(missing)
      expect(missingBody?.fields?.root_cause, 'root_cause should be reported as a field error').toBeTruthy()

      const resolved = await apiRequest(request, 'POST', `${INCIDENTS_API}/${incidentId}/transition`, {
        token,
        data: {
          status: 'resolved',
          fields: { root_cause: 'db outage' },
        },
      })
      expect(resolved.status(), 'resolving with root_cause should succeed').toBe(200)

      const detail = await readIncident(request, incidentId)
      expect(detail.status, 'incident should be resolved').toBe('resolved')
      expect(typeof detail.resolved_at, 'resolved_at should be set').toBe('string')
      expect(detail.snoozed_until, 'resolve cascade should clear snoozed_until').toBeNull()
      expect(detail.next_escalation_at, 'resolve cascade should clear next_escalation_at').toBeNull()
    } finally {
      await deleteIncidentIfExists(request, incidentId)
    }
  })

  test('change_severity updates severity_id', async ({ request }) => {
    let incidentId: string | null = null
    try {
      const severityId = await fetchSeededSeverityId(request)
      incidentId = await createIncident(request, { severityId })
      const nextSeverityId = await fetchDifferentSeverityId(request, severityId)

      const response = await apiRequest(request, 'POST', `${INCIDENTS_API}/${incidentId}/severity`, {
        token,
        data: { severityId: nextSeverityId },
      })
      expect(response.status(), 'severity change should succeed').toBe(200)

      const detail = await readIncident(request, incidentId)
      expect(detail.severity_id, 'incident severity_id should be updated').toBe(nextSeverityId)
    } finally {
      await deleteIncidentIfExists(request, incidentId)
    }
  })

  test('assign sets owner_user_id', async ({ request }) => {
    let incidentId: string | null = null
    try {
      expect(userId, 'admin token should contain a user id').toBeTruthy()
      incidentId = await createIncident(request)

      const response = await apiRequest(request, 'POST', `${INCIDENTS_API}/${incidentId}/assign`, {
        token,
        data: { ownerUserId: userId },
      })
      expect(response.status(), 'assign should succeed').toBe(200)

      const detail = await readIncident(request, incidentId)
      expect(detail.owner_user_id, 'owner_user_id should be set to the token subject').toBe(userId)
    } finally {
      await deleteIncidentIfExists(request, incidentId)
    }
  })

  test('escalate increments escalation_level', async ({ request }) => {
    let incidentId: string | null = null
    try {
      incidentId = await createIncident(request)
      const before = await readIncident(request, incidentId)
      const beforeLevel = before.escalation_level ?? 0

      const response = await apiRequest(request, 'POST', `${INCIDENTS_API}/${incidentId}/escalate`, { token })
      expect(response.status(), 'escalate should succeed').toBe(200)

      const detail = await readIncident(request, incidentId)
      expect(detail.escalation_level, 'escalation_level should increment').toBe(beforeLevel + 1)
    } finally {
      await deleteIncidentIfExists(request, incidentId)
    }
  })

  test('snooze sets snoozed_until', async ({ request }) => {
    let incidentId: string | null = null
    try {
      incidentId = await createIncident(request)
      const until = new Date(Date.now() + 60 * 60 * 1000).toISOString()

      const response = await apiRequest(request, 'POST', `${INCIDENTS_API}/${incidentId}/snooze`, {
        token,
        data: { until },
      })
      expect(response.status(), 'snooze should succeed').toBe(200)

      const detail = await readIncident(request, incidentId)
      expect(typeof detail.snoozed_until, 'snoozed_until should be set').toBe('string')
      expect(Date.parse(detail.snoozed_until as string), 'snoozed_until should be in the future').toBeGreaterThan(Date.now())
    } finally {
      await deleteIncidentIfExists(request, incidentId)
    }
  })
})
