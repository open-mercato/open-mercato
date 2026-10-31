import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
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
const BASE_URL = process.env.BASE_URL?.trim() || ''

type Scope = {
  organizationId: string
  tenantId: string
}

type ListResponse<T> = {
  items?: T[]
  total?: number
  page?: number
  pageSize?: number
  totalPages?: number
}

type IncidentRecord = {
  id: string
  number?: string | null
  title?: string | null
  status?: string | null
  severity_id?: string | null
  updated_at?: string | null
}

type SeverityRecord = {
  id: string
  key?: string | null
  label?: string | null
  rank?: number | null
  color_token?: string | null
  is_active?: boolean | null
  updated_at?: string | null
}

let token = ''
let scope: Scope
const createdIncidentIds = new Set<string>()
const createdSeverityIds = new Set<string>()

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

async function createIncident(
  request: APIRequestContext,
  input: { title?: string; severityId?: string } = {},
): Promise<string> {
  const severityId = input.severityId ?? await fetchSeededSeverityId(request)
  const response = await apiRequest(request, 'POST', INCIDENTS_API, {
    token,
    data: {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      title: input.title ?? uniqueTitle('INC test'),
      description: 'Playwright incident integration fixture',
      severityId,
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

async function deleteSeverityIfExists(request: APIRequestContext, id: string | null): Promise<void> {
  if (!token || !id) return
  try {
    await apiRequest(request, 'DELETE', `${SEVERITIES_API}?id=${encodeURIComponent(id)}`, { token })
  } catch {
    // Cleanup must not mask the assertion that already failed.
  } finally {
    createdSeverityIds.delete(id)
  }
}

async function putIncidentWithLock(
  request: APIRequestContext,
  id: string,
  title: string,
  lockValue: string,
) {
  return request.fetch(resolveApiUrl(INCIDENTS_API), {
    method: 'PUT',
    headers: authHeaders(lockValue),
    data: {
      id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      title,
    },
  })
}

test.describe('TC-INC-001: Incident CRUD + numbering + optimistic-lock + RBAC', () => {
  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin')
    scope = getTokenContext(token)
  })

  test.afterAll(async ({ request }) => {
    for (const id of Array.from(createdIncidentIds)) {
      await deleteIncidentIfExists(request, id)
    }
    for (const id of Array.from(createdSeverityIds)) {
      await deleteSeverityIfExists(request, id)
    }
  })

  test('create allocates an incident number and returns the editable version', async ({ request }) => {
    let incidentId: string | null = null
    try {
      incidentId = await createIncident(request, { title: uniqueTitle('INC test create') })

      const incident = await readIncident(request, incidentId)
      expect(incident.status, 'new incidents start open').toBe('open')
      expect(typeof incident.number, 'incident number should be present').toBe('string')
      expect(incident.number as string, 'incident number should use the configured INC prefix').toMatch(/^INC-/)
      expect(typeof incident.updated_at, 'detail response should expose updated_at').toBe('string')
    } finally {
      await deleteIncidentIfExists(request, incidentId)
    }
  })

  test('list returns a newly created incident', async ({ request }) => {
    let incidentId: string | null = null
    const title = uniqueTitle('INC test list')
    try {
      incidentId = await createIncident(request, { title })

      const response = await apiRequest(
        request,
        'GET',
        `${INCIDENTS_API}?pageSize=100&search=${encodeURIComponent(title)}`,
        { token },
      )
      expect(response.status(), 'GET /api/incidents should succeed').toBe(200)
      const body = await readJsonSafe<ListResponse<IncidentRecord>>(response)
      expect(
        itemsFrom(body).some((item) => item.id === incidentId),
        'created incident should appear in the list response',
      ).toBe(true)
    } finally {
      await deleteIncidentIfExists(request, incidentId)
    }
  })

  test('update succeeds with the correct lock and stale updates return optimistic-lock 409', async ({ request }) => {
    let incidentId: string | null = null
    try {
      incidentId = await createIncident(request, { title: uniqueTitle('INC test lock') })
      const before = await readIncident(request, incidentId)
      const staleUpdatedAt = before.updated_at
      expect(typeof staleUpdatedAt, 'detail response should expose updated_at for locking').toBe('string')

      await new Promise((resolve) => setTimeout(resolve, 5))
      const updateResponse = await putIncidentWithLock(
        request,
        incidentId,
        uniqueTitle('INC test lock updated'),
        staleUpdatedAt as string,
      )
      expect(updateResponse.status(), 'PUT /api/incidents with the current lock should succeed').toBe(200)

      let after = await readIncident(request, incidentId)
      if (after.updated_at === staleUpdatedAt) {
        await new Promise((resolve) => setTimeout(resolve, 5))
        const bumpResponse = await apiRequest(request, 'PUT', INCIDENTS_API, {
          token,
          data: {
            id: incidentId,
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            title: uniqueTitle('INC test lock bumped'),
          },
        })
        expect(bumpResponse.status(), 'headerless version bump should still succeed').toBe(200)
        after = await readIncident(request, incidentId)
      }
      expect(after.updated_at, 'happy update should advance updated_at').not.toBe(staleUpdatedAt)

      const conflictResponse = await putIncidentWithLock(
        request,
        incidentId,
        uniqueTitle('INC test stale write'),
        staleUpdatedAt as string,
      )
      expect(conflictResponse.status(), 'stale PUT should be refused').toBe(409)
      const conflict = await readJsonSafe<{ code?: string }>(conflictResponse)
      expect(conflict?.code, 'stale PUT should return the optimistic-lock conflict code').toBe(
        OPTIMISTIC_LOCK_CONFLICT_CODE,
      )
    } finally {
      await deleteIncidentIfExists(request, incidentId)
    }
  })

  test('concurrent incident creates allocate unique numbers', async ({ request }) => {
    const localIds: string[] = []
    try {
      const severityId = await fetchSeededSeverityId(request)
      const ids = await Promise.all(
        Array.from({ length: 5 }, (_, index) =>
          createIncident(request, {
            severityId,
            title: uniqueTitle(`INC test concurrent ${index}`),
          }),
        ),
      )
      localIds.push(...ids)

      const incidents = await Promise.all(ids.map((id) => readIncident(request, id)))
      const numbers = incidents.map((incident) => incident.number).filter((value): value is string => typeof value === 'string')
      expect(numbers, 'each concurrent create should allocate a number').toHaveLength(5)
      expect(new Set(numbers).size, 'concurrent incident numbers should be unique').toBe(5)
    } finally {
      await Promise.all(localIds.map((id) => deleteIncidentIfExists(request, id)))
    }
  })

  test('unauthenticated incident API requests are rejected', async ({ request }) => {
    const severityId = await fetchSeededSeverityId(request)
    const postResponse = await request.fetch(resolveApiUrl(INCIDENTS_API), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        title: uniqueTitle('INC test unauth'),
        severityId,
      },
    })
    expect(postResponse.status(), 'unauthenticated POST /api/incidents should be 401').toBe(401)

    const getResponse = await request.fetch(resolveApiUrl(INCIDENTS_API), { method: 'GET' })
    expect(getResponse.status(), 'unauthenticated GET /api/incidents should be 401').toBe(401)
  })

  test('severity catalog supports create, list, update, and delete', async ({ request }) => {
    const key = `test-${uniqueSuffix()}`
    const label = `Test severity ${uniqueSuffix()}`
    let severityId: string | null = null
    try {
      const createResponse = await apiRequest(request, 'POST', SEVERITIES_API, {
        token,
        data: {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          key,
          label,
          rank: 99,
          colorToken: 'info',
        },
      })
      expect(createResponse.status(), 'POST /api/incidents/severities should create a severity').toBe(201)
      const created = await readJsonSafe<{ id?: unknown }>(createResponse)
      severityId = expectId(created?.id, 'created severity should return an id')
      createdSeverityIds.add(severityId)

      const listResponse = await apiRequest(request, 'GET', `${SEVERITIES_API}?key=${encodeURIComponent(key)}`, { token })
      expect(listResponse.status(), 'GET /api/incidents/severities should succeed').toBe(200)
      const list = await readJsonSafe<ListResponse<SeverityRecord>>(listResponse)
      expect(
        itemsFrom(list).some((item) => item.id === severityId && item.key === key && item.color_token === 'info'),
        'created severity should appear in the catalog list',
      ).toBe(true)

      const updatedLabel = `${label} updated`
      const updateResponse = await apiRequest(request, 'PUT', SEVERITIES_API, {
        token,
        data: {
          id: severityId,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          label: updatedLabel,
        },
      })
      expect(updateResponse.status(), 'PUT /api/incidents/severities should update a severity').toBe(200)

      const detailResponse = await apiRequest(request, 'GET', `${SEVERITIES_API}?id=${encodeURIComponent(severityId)}`, { token })
      expect(detailResponse.status(), 'GET /api/incidents/severities?id=... should succeed').toBe(200)
      const detail = await readJsonSafe<ListResponse<SeverityRecord>>(detailResponse)
      expect(itemsFrom(detail)[0]?.label, 'updated severity label should be persisted').toBe(updatedLabel)

      const deleteResponse = await apiRequest(request, 'DELETE', `${SEVERITIES_API}?id=${encodeURIComponent(severityId)}`, { token })
      expect(deleteResponse.status(), 'DELETE /api/incidents/severities should delete a severity').toBe(200)
      createdSeverityIds.delete(severityId)
      severityId = null
    } finally {
      await deleteSeverityIfExists(request, severityId)
    }
  })
})
