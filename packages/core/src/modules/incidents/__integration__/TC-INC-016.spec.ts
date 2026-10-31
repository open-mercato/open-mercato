import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type APIRequestContext } from '@playwright/test'
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

type EphemeralEnv = {
  status?: string
  baseUrl?: string
  base_url?: string
  port?: string | number
}

type ListResponse<T> = {
  items?: T[]
  total?: number
}

type SeverityRecord = {
  id: string
}

type TimelineRecord = {
  id: string
  kind: string
  body?: string | null
  visibility: string
}

const RESOLVED_BASE_URL = resolveIntegrationBaseUrl()
if (RESOLVED_BASE_URL) {
  process.env.BASE_URL = RESOLVED_BASE_URL
  test.use({ baseURL: RESOLVED_BASE_URL })
}

function normalizeBaseUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed.replace(/\/+$/, '') : undefined
}

function resolveIntegrationBaseUrl(): string | undefined {
  const candidates = [
    resolve(process.cwd(), '.ai/qa/ephemeral-env.json'),
    resolve(process.cwd(), '../..', '.ai/qa/ephemeral-env.json'),
  ]
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    try {
      const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as EphemeralEnv
      if (parsed.status && parsed.status !== 'running') continue
      const fromBase = normalizeBaseUrl(parsed.baseUrl ?? parsed.base_url)
      if (fromBase) return fromBase
      const port = typeof parsed.port === 'number' ? parsed.port : Number(parsed.port)
      if (Number.isInteger(port) && port > 0) return `http://127.0.0.1:${port}`
    } catch {
      continue
    }
  }
  return normalizeBaseUrl(process.env.BASE_URL)
}

function resolveApiUrl(path: string): string {
  if (!RESOLVED_BASE_URL) return path
  return `${RESOLVED_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

function uniqueSuffix(): string {
  return `${Date.now()}-${randomUUID().slice(0, 8)}`
}

function itemsFrom<T>(body: ListResponse<T> | null): T[] {
  return Array.isArray(body?.items) ? body.items : []
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

async function getAuthToken(request: APIRequestContext): Promise<string> {
  const form = new URLSearchParams()
  form.set('email', 'admin@acme.com')
  form.set('password', 'secret')
  const response = await request.post(resolveApiUrl('/api/auth/login'), {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: form.toString(),
  })
  expect(response.status(), 'admin form login should succeed').toBe(200)
  const body = await readJsonSafe<{ token?: unknown }>(response)
  expect(typeof body?.token, 'login response should include a bearer token').toBe('string')
  return body!.token as string
}

async function apiFetch(
  request: APIRequestContext,
  method: string,
  path: string,
  token: string,
  data?: unknown,
) {
  return request.fetch(resolveApiUrl(path), {
    method,
    headers: authHeaders(token),
    ...(data === undefined ? {} : { data }),
  })
}

async function createSeverity(
  request: APIRequestContext,
  token: string,
  scope: Scope,
  label: string,
): Promise<string> {
  const response = await apiFetch(request, 'POST', SEVERITIES_API, token, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    key: `tc_inc_016_${randomUUID().slice(0, 8)}`,
    label,
    rank: 900,
    colorToken: 'info',
    isActive: true,
  })
  expect(response.status(), 'POST /api/incidents/severities should create a severity').toBe(201)
  const body = await readJsonSafe<{ id?: unknown }>(response)
  return expectId(body?.id, 'created severity should return id')
}

async function deleteSeverityIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  if (!token || !id) return
  await apiFetch(request, 'DELETE', `${SEVERITIES_API}?id=${encodeURIComponent(id)}`, token).catch(() => undefined)
}

async function createIncident(
  request: APIRequestContext,
  token: string,
  scope: Scope,
  severityId: string,
): Promise<string> {
  const response = await apiFetch(request, 'POST', INCIDENTS_API, token, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    title: `INC timeline filters ${uniqueSuffix()}`,
    description: 'Timeline filter integration fixture',
    severityId,
  })
  expect(response.status(), 'POST /api/incidents should create an incident').toBe(201)
  const body = await readJsonSafe<{ id?: unknown }>(response)
  return expectId(body?.id, 'created incident should return id')
}

async function deleteIncidentIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  if (!token || !id) return
  await apiFetch(request, 'DELETE', `${INCIDENTS_API}?id=${encodeURIComponent(id)}`, token).catch(() => undefined)
}

async function postTimeline(
  request: APIRequestContext,
  token: string,
  incidentId: string,
  data: { kind: 'note' | 'update'; body: string; visibility: 'internal' | 'customer_facing' },
): Promise<void> {
  const response = await apiFetch(request, 'POST', `${INCIDENTS_API}/${incidentId}/timeline`, token, data)
  expect(response.status(), `${data.kind} timeline entry should be accepted`).toBe(200)
  const body = await readJsonSafe<{ entryId?: unknown }>(response)
  expectId(body?.entryId, 'timeline response should include entryId')
}

async function changeSeverity(
  request: APIRequestContext,
  token: string,
  incidentId: string,
  severityId: string,
): Promise<void> {
  const response = await apiFetch(request, 'POST', `${INCIDENTS_API}/${incidentId}/severity`, token, { severityId })
  expect(response.status(), 'POST /api/incidents/{id}/severity should succeed').toBe(200)
}

async function listTimeline(
  request: APIRequestContext,
  token: string,
  incidentId: string,
  query = '',
): Promise<ListResponse<TimelineRecord>> {
  const response = await apiFetch(request, 'GET', `${INCIDENTS_API}/${incidentId}/timeline${query}`, token)
  expect(response.status(), `timeline list ${query || '(unfiltered)'} should succeed`).toBe(200)
  return await readJsonSafe<ListResponse<TimelineRecord>>(response) ?? {}
}

test.describe('TC-INC-016: Incident timeline filters API', () => {
  test('filters timeline entries by kind and visibility and rejects invalid kinds', async ({ request }) => {
    const token = await getAuthToken(request)
    const scope = getTokenContext(token)
    let severityOneId: string | null = null
    let severityTwoId: string | null = null
    let incidentId: string | null = null

    try {
      severityOneId = await createSeverity(request, token, scope, `TC-INC-016 Initial ${uniqueSuffix()}`)
      severityTwoId = await createSeverity(request, token, scope, `TC-INC-016 Changed ${uniqueSuffix()}`)
      incidentId = await createIncident(request, token, scope, severityOneId)
      const noteBody = `internal filter note ${uniqueSuffix()}`
      const updateBody = `customer filter update ${uniqueSuffix()}`

      await postTimeline(request, token, incidentId, {
        kind: 'note',
        body: noteBody,
        visibility: 'internal',
      })
      await postTimeline(request, token, incidentId, {
        kind: 'update',
        body: updateBody,
        visibility: 'customer_facing',
      })
      await changeSeverity(request, token, incidentId, severityTwoId)

      const all = await listTimeline(request, token, incidentId)
      const allItems = itemsFrom(all)
      expect(allItems.some((entry) => entry.kind === 'severity_change'), 'severity change should create a timeline entry').toBe(true)

      const kindFiltered = await listTimeline(request, token, incidentId, '?kinds=note,update&pageSize=50')
      const kindItems = itemsFrom(kindFiltered)
      expect(kindItems.length, 'filtered items length should match filtered total').toBe(kindFiltered.total)
      expect(kindItems.map((entry) => entry.kind).sort(), 'kind filter should return only note/update entries').toEqual(['note', 'update'])
      expect(kindItems.map((entry) => entry.body)).toEqual(expect.arrayContaining([noteBody, updateBody]))

      const internalFiltered = await listTimeline(request, token, incidentId, '?visibility=internal&pageSize=50')
      const internalItems = itemsFrom(internalFiltered)
      expect(internalItems.length, 'visibility-filtered items length should match filtered total').toBe(internalFiltered.total)
      expect(internalItems.every((entry) => entry.visibility === 'internal'), 'visibility=internal should return only internal entries').toBe(true)
      expect(internalItems.map((entry) => entry.body)).toContain(noteBody)
      expect(internalItems.map((entry) => entry.body)).not.toContain(updateBody)

      const invalid = await apiFetch(request, 'GET', `${INCIDENTS_API}/${incidentId}/timeline?kinds=bogus`, token)
      expect(invalid.status(), 'invalid timeline kind should be rejected with 400').toBe(400)
    } finally {
      await deleteIncidentIfExists(request, token, incidentId)
      await deleteSeverityIfExists(request, token, severityTwoId)
      await deleteSeverityIfExists(request, token, severityOneId)
    }
  })
})
