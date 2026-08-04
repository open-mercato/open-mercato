import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  OPTIMISTIC_LOCK_HEADER_NAME,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

export const integrationMeta = {
  dependsOnModules: ['incidents'],
}

const INCIDENTS_API = '/api/incidents'
const SEVERITIES_API = '/api/incidents/severities'
const TYPES_API = '/api/incidents/types'
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
  number?: string | null
  status?: string | null
  updated_at?: string | null
  resolved_at?: string | null
  merged_into_incident_id?: string | null
  escalation_status?: string | null
  next_escalation_at?: string | null
}

type SeverityRecord = {
  id: string
}

type IncidentTypeRecord = {
  id: string
  required_fields_on_resolve?: string[] | null
}

type LinkRecord = {
  id: string
  kind: string
  direction: 'outgoing' | 'incoming'
  linkedIncident: {
    id: string
    number: string
    title: string
    status: string
  }
}

type TimelineRecord = {
  id: string
  incidentId: string
  kind: string
  metadata: Record<string, unknown> | null
}

type ActionItemRecord = {
  id: string
  incidentId: string
  title: string
}

type ImpactRecord = {
  id: string
  incident_id: string
  target_type: string
  component_label: string | null
}

type CommandResponse = {
  ok?: boolean
  linkId?: unknown
  alreadyLinked?: boolean
  actionItemId?: unknown
  impactId?: unknown
  targetIncidentId?: unknown
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
  input: { title?: string; incidentTypeId?: string } = {},
): Promise<string> {
  const data: Record<string, unknown> = {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    title: input.title ?? uniqueTitle('INC merge test'),
    description: 'Playwright link/merge/reopen integration fixture',
    severityId: await fetchSeededSeverityId(request),
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

async function listLinks(request: APIRequestContext, incidentId: string): Promise<LinkRecord[]> {
  const response = await apiRequest(request, 'GET', `${INCIDENTS_API}/${incidentId}/links`, { token })
  expect(response.status(), 'links list should succeed').toBe(200)
  const body = await readJsonSafe<ListResponse<LinkRecord>>(response)
  return itemsFrom(body)
}

async function listTimeline(request: APIRequestContext, incidentId: string): Promise<TimelineRecord[]> {
  const response = await apiRequest(request, 'GET', `${INCIDENTS_API}/${incidentId}/timeline?pageSize=100`, { token })
  expect(response.status(), 'timeline list should succeed').toBe(200)
  const body = await readJsonSafe<ListResponse<TimelineRecord>>(response)
  return itemsFrom(body)
}

async function listActionItems(request: APIRequestContext, incidentId: string): Promise<ActionItemRecord[]> {
  const response = await apiRequest(request, 'GET', `${INCIDENTS_API}/${incidentId}/action-items`, { token })
  expect(response.status(), 'action items list should succeed').toBe(200)
  const body = await readJsonSafe<ListResponse<ActionItemRecord>>(response)
  return itemsFrom(body)
}

async function listImpacts(request: APIRequestContext, incidentId: string): Promise<ImpactRecord[]> {
  const response = await apiRequest(request, 'GET', `${INCIDENTS_API}/${incidentId}/impacts`, { token })
  expect(response.status(), 'impacts list should succeed').toBe(200)
  const body = await readJsonSafe<ListResponse<ImpactRecord>>(response)
  return itemsFrom(body)
}

test.describe('TC-INC-008: Incident links, merge, and reopen', () => {
  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin')
    scope = getTokenContext(token)
  })

  test.afterAll(async ({ request }) => {
    for (const id of Array.from(createdIncidentIds)) {
      await deleteIncidentIfExists(request, id)
    }
  })

  test('links are bidirectional, idempotent, self-links fail, and unlink clears both lists', async ({ request }) => {
    let xId: string | null = null
    let yId: string | null = null
    try {
      xId = await createIncident(request, { title: uniqueTitle('INC link source') })
      yId = await createIncident(request, { title: uniqueTitle('INC link target') })

      const link = await fetchWithCurrentIncidentLock(request, xId, 'POST', `${INCIDENTS_API}/${xId}/links`, {
        linkedIncidentId: yId,
        kind: 'related',
      })
      expect(link.status, 'link should succeed').toBe(200)
      const linkId = expectId(link.body?.linkId, 'link response should return linkId')
      expect(link.body?.alreadyLinked, 'first link should not be reported as pre-existing').toBeUndefined()

      const repeat = await fetchWithCurrentIncidentLock(request, xId, 'POST', `${INCIDENTS_API}/${xId}/links`, {
        linkedIncidentId: yId,
        kind: 'related',
      })
      expect(repeat.status, 'repeat link should be idempotent').toBe(200)
      expect(repeat.body?.alreadyLinked, 'repeat link should report alreadyLinked').toBe(true)
      expect(repeat.body?.linkId, 'repeat link should return the existing link id').toBe(linkId)

      const incoming = await listLinks(request, yId)
      expect(
        incoming.some((item) =>
          item.id === linkId &&
          item.kind === 'related' &&
          item.direction === 'incoming' &&
          item.linkedIncident.id === xId,
        ),
        'target incident should show the source link as incoming',
      ).toBe(true)

      const selfLink = await fetchWithCurrentIncidentLock(request, xId, 'POST', `${INCIDENTS_API}/${xId}/links`, {
        linkedIncidentId: xId,
        kind: 'related',
      })
      expect(selfLink.status, 'self-link should be rejected').toBe(400)

      const unlink = await fetchWithCurrentIncidentLock(request, xId, 'DELETE', `${INCIDENTS_API}/${xId}/links/${linkId}`)
      expect(unlink.status, 'unlink should succeed').toBe(200)
      expect(await listLinks(request, xId), 'source links should be empty after unlink').toEqual([])
      expect(await listLinks(request, yId), 'target links should be empty after unlink').toEqual([])
    } finally {
      await deleteIncidentIfExists(request, xId)
      await deleteIncidentIfExists(request, yId)
    }
  })

  test('merge closes the source, moves action items and impacts, records timelines, and blocks source mutations', async ({ request }) => {
    let xId: string | null = null
    let yId: string | null = null
    let zId: string | null = null
    try {
      xId = await createIncident(request, { title: uniqueTitle('INC merge source') })
      yId = await createIncident(request, { title: uniqueTitle('INC merge target') })
      zId = await createIncident(request, { title: uniqueTitle('INC merge second target') })
      const sourceBefore = await readIncident(request, xId)
      const sourceNumber = sourceBefore.number
      expect(typeof sourceNumber, 'source incident should have a number').toBe('string')
      expect(sourceBefore.escalation_status, 'declared incident should start escalation before merge').toBe('active')

      const action = await fetchWithCurrentIncidentLock(request, xId, 'POST', `${INCIDENTS_API}/${xId}/action-items`, {
        title: `merge action ${uniqueSuffix()}`,
      })
      expect(action.status, 'source action item setup should succeed').toBe(200)
      const actionItemId = expectId(action.body?.actionItemId, 'source action item setup should return actionItemId')

      const componentLabel = `component-${uniqueSuffix()}`
      const impact = await fetchWithCurrentIncidentLock(request, xId, 'POST', `${INCIDENTS_API}/${xId}/impacts`, {
        targetType: 'component',
        componentLabel,
        impactStatus: 'major_outage',
        snapshot: { label: componentLabel },
      })
      expect([200, 201], 'source impact setup should succeed').toContain(impact.status)
      const impactId = expectId(impact.body?.impactId, 'source impact setup should return impactId')

      const merge = await fetchWithCurrentIncidentLock(request, xId, 'POST', `${INCIDENTS_API}/${xId}/merge`, {
        targetIncidentId: yId,
      })
      expect(merge.status, 'merge should succeed').toBe(200)
      expect(merge.body?.targetIncidentId, 'merge response should echo the target incident id').toBe(yId)

      const sourceAfter = await readIncident(request, xId)
      expect(sourceAfter.status, 'source should be closed after merge').toBe('closed')
      expect(sourceAfter.merged_into_incident_id, 'source should point at merge target').toBe(yId)
      expect(sourceAfter.number, 'source number should be preserved').toBe(sourceNumber)
      expect(sourceAfter.escalation_status, 'merge close cascade should clear escalation status').toBe('inactive')
      expect(sourceAfter.next_escalation_at, 'merge close cascade should clear next escalation').toBeNull()

      expect(
        (await listActionItems(request, yId)).some((item) => item.id === actionItemId && item.incidentId === yId),
        'target should list the source action item after merge',
      ).toBe(true)
      expect(
        (await listImpacts(request, yId)).some((item) =>
          item.id === impactId &&
          item.incident_id === yId &&
          item.target_type === 'component' &&
          item.component_label === componentLabel,
        ),
        'target should list the source impact after merge',
      ).toBe(true)

      expect(
        (await listTimeline(request, xId)).some((entry) => entry.kind === 'merged_into'),
        'source timeline should contain merged_into',
      ).toBe(true)
      expect(
        (await listTimeline(request, yId)).some((entry) => entry.kind === 'merged_from'),
        'target timeline should contain merged_from',
      ).toBe(true)

      const mergeAgain = await fetchWithCurrentIncidentLock(request, xId, 'POST', `${INCIDENTS_API}/${xId}/merge`, {
        targetIncidentId: zId,
      })
      expect(mergeAgain.status, 'merged source cannot be merged again').toBe(409)

      const acknowledge = await apiRequest(request, 'POST', `${INCIDENTS_API}/${xId}/acknowledge`, { token })
      expect(acknowledge.status(), 'merged source cannot be acknowledged').toBe(409)

      const timeline = await apiRequest(request, 'POST', `${INCIDENTS_API}/${xId}/timeline`, {
        token,
        data: { kind: 'note', body: 'must not write to merged source', visibility: 'internal' },
      })
      expect(timeline.status(), 'merged source cannot receive timeline entries').toBe(409)

      const reopen = await apiRequest(request, 'POST', `${INCIDENTS_API}/${xId}/transition`, {
        token,
        data: { status: 'open' },
      })
      expect(reopen.status(), 'merged source cannot be reopened').toBe(409)
    } finally {
      await deleteIncidentIfExists(request, xId)
      await deleteIncidentIfExists(request, yId)
      await deleteIncidentIfExists(request, zId)
    }
  })

  test('resolved incidents can reopen, clearing resolved_at while preserving the postmortem draft', async ({ request }) => {
    let incidentId: string | null = null
    try {
      incidentId = await createIncident(request, {
        title: uniqueTitle('INC reopen target'),
        incidentTypeId: await fetchTypeRequiringRootCause(request),
      })

      const resolve = await fetchWithCurrentIncidentLock(request, incidentId, 'POST', `${INCIDENTS_API}/${incidentId}/transition`, {
        status: 'resolved',
        fields: { root_cause: 'dependency outage' },
      })
      expect(resolve.status, 'resolve with required root_cause should succeed').toBe(200)
      let detail = await readIncident(request, incidentId)
      expect(detail.status, 'incident should be resolved before reopen').toBe('resolved')
      expect(typeof detail.resolved_at, 'resolved_at should be set before reopen').toBe('string')

      const draftResponse = await apiRequest(request, 'GET', `${INCIDENTS_API}/${incidentId}/postmortem`, { token })
      expect(draftResponse.status(), 'postmortem created by resolve gate should be readable').toBe(200)
      const draft = await readJsonSafe<{ item?: { id?: string; status?: string; rootCause?: string | null } | null }>(draftResponse)
      const postmortemId = expectId(draft?.item?.id, 'resolve gate should create a postmortem draft')
      expect(draft?.item?.status, 'resolve-created postmortem should be draft').toBe('draft')
      expect(draft?.item?.rootCause, 'resolve gate should persist rootCause').toBe('dependency outage')

      const reopen = await fetchWithCurrentIncidentLock(request, incidentId, 'POST', `${INCIDENTS_API}/${incidentId}/transition`, {
        status: 'open',
      })
      expect(reopen.status, 'resolved -> open reopen should succeed').toBe(200)

      detail = await readIncident(request, incidentId)
      expect(detail.status, 'incident should be open after reopen').toBe('open')
      expect(detail.resolved_at, 'reopen should clear resolved_at').toBeNull()
      expect(
        (await listTimeline(request, incidentId)).some((entry) => entry.kind === 'reopened'),
        'timeline should contain reopened entry',
      ).toBe(true)

      const afterReopenResponse = await apiRequest(request, 'GET', `${INCIDENTS_API}/${incidentId}/postmortem`, { token })
      expect(afterReopenResponse.status(), 'postmortem should remain readable after reopen').toBe(200)
      const afterReopen = await readJsonSafe<{ item?: { id?: string; status?: string } | null }>(afterReopenResponse)
      expect(afterReopen?.item?.id, 'reopen should preserve the existing postmortem').toBe(postmortemId)
      expect(afterReopen?.item?.status, 'reopen should not publish or delete the postmortem').toBe('draft')
    } finally {
      await deleteIncidentIfExists(request, incidentId)
    }
  })
})
