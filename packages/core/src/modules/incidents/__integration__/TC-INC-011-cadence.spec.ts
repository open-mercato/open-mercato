// NOTE: mutates the tenant-singleton incident_settings row — run serially with other
// settings-mutating incidents specs (workers=1), mirroring the repo's serial-suite convention.
import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

export const integrationMeta = {
  dependsOnModules: ['incidents'],
}

const INCIDENTS_API = '/api/incidents'
const SEVERITIES_API = '/api/incidents/severities'
const SETTINGS_API = '/api/incidents/settings'
const BASE_URL = process.env.BASE_URL?.trim() || ''

type Scope = {
  organizationId: string
  tenantId: string
}

type ListResponse<T> = {
  items?: T[]
}

type SeverityRecord = {
  id: string
  key?: string | null
  label?: string | null
  rank?: number | null
  color_token?: string | null
  is_default?: boolean | null
  is_active?: boolean | null
}

type SettingsRecord = {
  id: string
  number_format?: string | null
  ack_timeout_minutes?: number | null
  escalation_timeout_minutes?: number | null
  default_escalation_policy_id?: string | null
  sla_targets?: unknown
  update_cadence?: Record<string, { updateMinutes: number }> | null
  updated_at?: string | null
}

type IncidentRecord = {
  id: string
  title?: string | null
  status?: string | null
  updated_at?: string | null
  next_update_due_at?: string | null
  nextUpdateDueAt?: string | null
}

let token = ''
let scope: Scope
const createdIncidentIds = new Set<string>()
const createdSeverityIds = new Set<string>()

function resolveApiUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

function authHeaders(lockValue?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
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

function nextUpdateDueAt(record: IncidentRecord): string | null {
  return record.nextUpdateDueAt ?? record.next_update_due_at ?? null
}

async function fetchSeverities(request: APIRequestContext): Promise<SeverityRecord[]> {
  const response = await apiRequest(request, 'GET', `${SEVERITIES_API}?isActive=true&pageSize=100`, { token })
  expect(response.status(), 'GET /api/incidents/severities should succeed').toBe(200)
  const body = await readJsonSafe<ListResponse<SeverityRecord>>(response)
  return itemsFrom(body)
}

async function fetchDefaultSeverity(request: APIRequestContext): Promise<SeverityRecord> {
  const severities = await fetchSeverities(request)
  const severity = severities.find((item) => item.is_default === true) ?? severities[0]
  expect(severity?.id && severity.key, 'an active default/keyed incident severity should exist').toBeTruthy()
  return severity!
}

async function fetchSettings(request: APIRequestContext): Promise<SettingsRecord> {
  const response = await apiRequest(request, 'GET', `${SETTINGS_API}?page=1&pageSize=5`, { token })
  expect(response.status(), 'GET /api/incidents/settings should succeed').toBe(200)
  const body = await readJsonSafe<ListResponse<SettingsRecord>>(response)
  const settings = itemsFrom(body)[0]
  expect(settings?.id, 'incident settings row should exist').toBeTruthy()
  return settings!
}

async function updateSettingsCadence(
  request: APIRequestContext,
  settings: SettingsRecord,
  updateCadence: Record<string, { updateMinutes: number }> | null,
): Promise<void> {
  const response = await apiRequest(request, 'PUT', SETTINGS_API, {
    token,
    data: {
      id: settings.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      updateCadence,
    },
  })
  expect(response.status(), 'PUT /api/incidents/settings should update cadence').toBe(200)
}

async function createSeverity(request: APIRequestContext): Promise<SeverityRecord> {
  const key = `qa-cadence-${uniqueSuffix()}`
  const response = await apiRequest(request, 'POST', SEVERITIES_API, {
    token,
    data: {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      key,
      label: `QA cadence severity ${key}`,
      rank: 998,
      colorToken: 'info',
      isDefault: false,
      isActive: true,
    },
  })
  expect(response.status(), 'POST /api/incidents/severities should create a no-cadence severity').toBe(201)
  const body = await readJsonSafe<{ id?: unknown }>(response)
  const id = expectId(body?.id, 'created severity should return id')
  createdSeverityIds.add(id)
  return { id, key, label: `QA cadence severity ${key}`, is_active: true, is_default: false }
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

async function createIncident(
  request: APIRequestContext,
  input: { title: string; severityId: string },
): Promise<string> {
  const response = await apiRequest(request, 'POST', INCIDENTS_API, {
    token,
    data: {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      title: input.title,
      description: 'Playwright cadence integration fixture',
      severityId: input.severityId,
    },
  })
  expect(response.status(), 'POST /api/incidents should create an incident').toBe(201)
  const body = await readJsonSafe<{ id?: unknown }>(response)
  const id = expectId(body?.id, 'created incident should return id')
  createdIncidentIds.add(id)
  return id
}

async function readIncident(request: APIRequestContext, id: string): Promise<IncidentRecord> {
  const response = await apiRequest(request, 'GET', `${INCIDENTS_API}?id=${encodeURIComponent(id)}`, { token })
  expect(response.status(), 'GET /api/incidents?id=... should succeed').toBe(200)
  const body = await readJsonSafe<ListResponse<IncidentRecord>>(response)
  const incident = itemsFrom(body).find((item) => item.id === id)
  expect(incident, `incident ${id} should be returned by detail GET`).toBeTruthy()
  return incident!
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

async function postTimelineEntry(
  request: APIRequestContext,
  incidentId: string,
  input: { body: string; visibility: 'internal' | 'customer_facing'; kind: 'note' | 'update' },
): Promise<void> {
  const incident = await readIncident(request, incidentId)
  expect(typeof incident.updated_at, 'incident detail should expose updated_at for timeline locking').toBe('string')
  const response = await request.fetch(resolveApiUrl(`${INCIDENTS_API}/${incidentId}/timeline`), {
    method: 'POST',
    headers: authHeaders(incident.updated_at),
    data: input,
  })
  expect(response.status(), `${input.visibility} timeline entry should be accepted`).toBe(200)
}

async function resolveIncident(request: APIRequestContext, incidentId: string): Promise<void> {
  const incident = await readIncident(request, incidentId)
  expect(typeof incident.updated_at, 'incident detail should expose updated_at for resolve locking').toBe('string')
  const response = await request.fetch(resolveApiUrl(`${INCIDENTS_API}/${incidentId}/transition`), {
    method: 'POST',
    headers: authHeaders(incident.updated_at),
    data: {
      status: 'resolved',
      fields: {
        rootCause: 'QA cadence root cause confirmed',
        impact: 'QA cadence impact confirmed',
        summary: 'QA cadence resolution summary',
      },
    },
  })
  expect(response.status(), 'resolved transition with required fields should succeed').toBe(200)
}

function expectDueAround(value: string | null, before: Date, after: Date, updateMinutes: number): void {
  expect(typeof value, 'nextUpdateDueAt should be returned as an ISO string').toBe('string')
  const dueMs = Date.parse(value as string)
  expect(Number.isNaN(dueMs), 'nextUpdateDueAt should parse as a date').toBe(false)
  const expectedMs = updateMinutes * 60_000
  expect(dueMs, 'nextUpdateDueAt should not be earlier than now + cadence').toBeGreaterThanOrEqual(
    before.getTime() + expectedMs - 2_000,
  )
  expect(dueMs, 'nextUpdateDueAt should be close to now + cadence').toBeLessThanOrEqual(
    after.getTime() + expectedMs + 15_000,
  )
}

test.describe('TC-INC-011: Incident customer-update cadence API', () => {
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

  test('computes, recomputes, preserves, clears, and omits nextUpdateDueAt by severity cadence', async ({ request }) => {
    const settings = await fetchSettings(request)
    const originalCadence = settings.update_cadence ?? null
    const defaultSeverity = await fetchDefaultSeverity(request)
    const cadenceMinutes = 7
    let incidentId: string | null = null
    let noCadenceIncidentId: string | null = null
    let noCadenceSeverityId: string | null = null

    try {
      await updateSettingsCadence(request, settings, {
        [defaultSeverity.key as string]: { updateMinutes: cadenceMinutes },
      })

      const beforeCreate = new Date()
      incidentId = await createIncident(request, {
        title: `INC cadence ${uniqueSuffix()}`,
        severityId: defaultSeverity.id,
      })
      const afterCreate = new Date()
      const created = await readIncident(request, incidentId)
      const createdDue = nextUpdateDueAt(created)
      expectDueAround(createdDue, beforeCreate, afterCreate, cadenceMinutes)

      await new Promise((resolve) => setTimeout(resolve, 25))
      await postTimelineEntry(request, incidentId, {
        kind: 'update',
        visibility: 'customer_facing',
        body: `Customer-facing cadence update ${uniqueSuffix()}`,
      })
      const afterCustomerUpdate = await readIncident(request, incidentId)
      const customerDue = nextUpdateDueAt(afterCustomerUpdate)
      expect(typeof customerDue, 'customer-facing update should leave nextUpdateDueAt set').toBe('string')
      expect(Date.parse(customerDue as string), 'customer-facing update should push due time later').toBeGreaterThan(
        Date.parse(createdDue as string),
      )

      await postTimelineEntry(request, incidentId, {
        kind: 'note',
        visibility: 'internal',
        body: `Internal cadence note ${uniqueSuffix()}`,
      })
      const afterInternal = await readIncident(request, incidentId)
      expect(nextUpdateDueAt(afterInternal), 'internal timeline entries should not recompute nextUpdateDueAt').toBe(customerDue)

      await resolveIncident(request, incidentId)
      const resolved = await readIncident(request, incidentId)
      expect(nextUpdateDueAt(resolved), 'resolved incidents should clear nextUpdateDueAt').toBeNull()

      const noCadenceSeverity = await createSeverity(request)
      noCadenceSeverityId = noCadenceSeverity.id
      noCadenceIncidentId = await createIncident(request, {
        title: `INC no cadence ${uniqueSuffix()}`,
        severityId: noCadenceSeverity.id,
      })
      const noCadenceIncident = await readIncident(request, noCadenceIncidentId)
      expect(nextUpdateDueAt(noCadenceIncident), 'severity without cadence should return null nextUpdateDueAt').toBeNull()
    } finally {
      await deleteIncidentIfExists(request, incidentId)
      await deleteIncidentIfExists(request, noCadenceIncidentId)
      await deleteSeverityIfExists(request, noCadenceSeverityId)
      await updateSettingsCadence(request, settings, originalCadence).catch(() => undefined)
    }
  })
})
