import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  expectId,
  getTokenContext,
  getTokenScope,
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
}

type SeverityRecord = {
  id: string
}

type TimelineRecord = {
  id: string
  incidentId: string
  kind: string
  body?: string | null
  visibility: string
}

type ParticipantRecord = {
  id: string
  incidentId: string
  userId: string
  kind: string
  roleId?: string | null
}

let token = ''
let scope: Scope
let userId = ''
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

async function createIncident(request: APIRequestContext): Promise<string> {
  const response = await apiRequest(request, 'POST', INCIDENTS_API, {
    token,
    data: {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      title: uniqueTitle('INC collaboration test'),
      description: 'Playwright collaboration integration fixture',
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

async function postTimeline(
  request: APIRequestContext,
  incidentId: string,
  data: Record<string, unknown>,
  lockValue?: string,
) {
  return request.fetch(resolveApiUrl(`${INCIDENTS_API}/${incidentId}/timeline`), {
    method: 'POST',
    headers: authHeaders(lockValue),
    data,
  })
}

test.describe('TC-INC-003: Incident timeline + participants', () => {
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

  test('timeline add and list returns internal and customer-facing entries decrypted', async ({ request }) => {
    let incidentId: string | null = null
    try {
      incidentId = await createIncident(request)
      const internalBody = `internal note ${uniqueSuffix()}`
      const customerBody = `customer update ${uniqueSuffix()}`

      const internal = await postTimeline(request, incidentId, {
        kind: 'note',
        body: internalBody,
        visibility: 'internal',
      })
      expect(internal.status(), 'internal timeline note should be accepted').toBe(200)
      const internalCreated = await readJsonSafe<{ entryId?: unknown }>(internal)
      expectId(internalCreated?.entryId, 'internal timeline response should return entryId')

      const customer = await postTimeline(request, incidentId, {
        kind: 'update',
        body: customerBody,
        visibility: 'customer_facing',
      })
      expect(customer.status(), 'customer-facing timeline update should be accepted').toBe(200)
      const customerCreated = await readJsonSafe<{ entryId?: unknown }>(customer)
      expectId(customerCreated?.entryId, 'customer-facing timeline response should return entryId')

      const listResponse = await apiRequest(request, 'GET', `${INCIDENTS_API}/${incidentId}/timeline`, { token })
      expect(listResponse.status(), 'timeline list should succeed').toBe(200)
      const list = await readJsonSafe<ListResponse<TimelineRecord>>(listResponse)
      const items = itemsFrom(list)
      expect(
        items.some((item) => item.body === internalBody && item.visibility === 'internal'),
        'timeline should include the internal note body with internal visibility',
      ).toBe(true)
      expect(
        items.some((item) => item.body === customerBody && item.visibility === 'customer_facing'),
        'timeline should include the customer update body with customer-facing visibility',
      ).toBe(true)
    } finally {
      await deleteIncidentIfExists(request, incidentId)
    }
  })

  test('timeline writes enforce the parent incident optimistic-lock header', async ({ request }) => {
    let incidentId: string | null = null
    try {
      incidentId = await createIncident(request)
      const before = await readIncident(request, incidentId)
      const staleUpdatedAt = before.updated_at
      expect(typeof staleUpdatedAt, 'incident detail should expose updated_at for aggregate locking').toBe('string')

      await new Promise((resolve) => setTimeout(resolve, 5))
      const bump = await postTimeline(request, incidentId, {
        kind: 'note',
        body: `version bump ${uniqueSuffix()}`,
        visibility: 'internal',
      })
      expect(bump.status(), 'headerless timeline write should advance the aggregate version').toBe(200)

      let after = await readIncident(request, incidentId)
      if (after.updated_at === staleUpdatedAt) {
        await new Promise((resolve) => setTimeout(resolve, 5))
        const secondBump = await postTimeline(request, incidentId, {
          kind: 'note',
          body: `second version bump ${uniqueSuffix()}`,
          visibility: 'internal',
        })
        expect(secondBump.status(), 'second timeline write should advance the aggregate version').toBe(200)
        after = await readIncident(request, incidentId)
      }
      expect(after.updated_at, 'timeline write should bump the parent incident updated_at').not.toBe(staleUpdatedAt)

      const stale = await postTimeline(
        request,
        incidentId,
        {
          kind: 'note',
          body: `stale note ${uniqueSuffix()}`,
          visibility: 'internal',
        },
        staleUpdatedAt as string,
      )
      expect(stale.status(), 'stale timeline write should be refused').toBe(409)
      const conflict = await readJsonSafe<{ code?: string }>(stale)
      expect(conflict?.code, 'timeline stale write should return the optimistic-lock conflict code').toBe(
        OPTIMISTIC_LOCK_CONFLICT_CODE,
      )
    } finally {
      await deleteIncidentIfExists(request, incidentId)
    }
  })

  test('participants add, list, and remove active responders', async ({ request }) => {
    let incidentId: string | null = null
    let participantId: string | null = null
    try {
      expect(userId, 'admin token should contain a user id').toBeTruthy()
      incidentId = await createIncident(request)

      const createResponse = await apiRequest(request, 'POST', `${INCIDENTS_API}/${incidentId}/participants`, {
        token,
        data: {
          userId,
          kind: 'responder',
        },
      })
      expect(createResponse.status(), 'participant add should succeed').toBe(200)
      const created = await readJsonSafe<{ participantId?: unknown }>(createResponse)
      participantId = expectId(created?.participantId, 'participant add should return participantId')

      const listResponse = await apiRequest(request, 'GET', `${INCIDENTS_API}/${incidentId}/participants`, { token })
      expect(listResponse.status(), 'participant list should succeed').toBe(200)
      const list = await readJsonSafe<ListResponse<ParticipantRecord>>(listResponse)
      expect(
        itemsFrom(list).some((item) => item.id === participantId && item.userId === userId && item.kind === 'responder'),
        'participant list should include the active responder',
      ).toBe(true)

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `${INCIDENTS_API}/${incidentId}/participants/${participantId}`,
        { token },
      )
      expect(deleteResponse.status(), 'participant delete should succeed').toBe(200)

      const afterDeleteResponse = await apiRequest(request, 'GET', `${INCIDENTS_API}/${incidentId}/participants`, { token })
      expect(afterDeleteResponse.status(), 'participant list after delete should succeed').toBe(200)
      const afterDelete = await readJsonSafe<ListResponse<ParticipantRecord>>(afterDeleteResponse)
      expect(
        itemsFrom(afterDelete).some((item) => item.id === participantId),
        'removed participant should no longer be active',
      ).toBe(false)
    } finally {
      await deleteIncidentIfExists(request, incidentId)
    }
  })
})
