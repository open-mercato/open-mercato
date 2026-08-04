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

type PostmortemRecord = {
  id: string
  incidentId: string
  summary: string | null
  rootCause: string | null
  impact: string | null
  contributingFactors: string | null
  lessons: string | null
  status: string
  publishedAt: string | null
  updatedAt: string
}

type PostmortemResponse = {
  item: PostmortemRecord | null
}

type ActionItemRecord = {
  id: string
  incidentId: string
  title: string
  assigneeUserId: string | null
  status: string
  dueAt: string | null
  completedAt: string | null
  createdAt: string
}

type CommandResponse = {
  ok?: boolean
  postmortemId?: unknown
  actionItemId?: unknown
  updatedAt?: unknown
  publishedAt?: unknown
  code?: unknown
  error?: unknown
}

let token = ''
let scope: Scope
let userId = ''
const createdIncidentIds = new Set<string>()

function resolveApiUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

function authHeaders(actorToken: string, lockValue?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${actorToken}`,
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

async function createIncident(request: APIRequestContext, title = uniqueTitle('INC postmortem test')): Promise<string> {
  const response = await apiRequest(request, 'POST', INCIDENTS_API, {
    token,
    data: {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      title,
      description: 'Playwright postmortem/action-items integration fixture',
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
    headers: authHeaders(token, incident.updated_at as string),
    data,
  })
  return { status: response.status(), body: await readJsonSafe<CommandResponse>(response) }
}

async function listActionItems(request: APIRequestContext, incidentId: string): Promise<ActionItemRecord[]> {
  const response = await apiRequest(request, 'GET', `${INCIDENTS_API}/${incidentId}/action-items`, { token })
  expect(response.status(), 'action item list should succeed').toBe(200)
  const body = await readJsonSafe<ListResponse<ActionItemRecord>>(response)
  return itemsFrom(body)
}

test.describe('TC-INC-007: Incident postmortem + action items', () => {
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

  test('postmortem starts empty, round-trips draft fields, publishes once, and rejects published edits', async ({ request }) => {
    let incidentId: string | null = null
    try {
      incidentId = await createIncident(request)

      const emptyResponse = await apiRequest(request, 'GET', `${INCIDENTS_API}/${incidentId}/postmortem`, { token })
      expect(emptyResponse.status(), 'GET postmortem should succeed before one exists').toBe(200)
      const empty = await readJsonSafe<PostmortemResponse>(emptyResponse)
      expect(empty?.item, 'new incident should have no postmortem').toBeNull()

      const summary = `summary ${uniqueSuffix()}`
      const rootCause = `root cause ${uniqueSuffix()}`
      const upsert = await fetchWithCurrentIncidentLock(request, incidentId, 'PUT', `${INCIDENTS_API}/${incidentId}/postmortem`, {
        summary,
        rootCause,
      })
      expect(upsert.status, 'PUT postmortem should succeed').toBe(200)
      expect(upsert.body?.ok, 'PUT postmortem should return ok').toBe(true)
      expectId(upsert.body?.postmortemId, 'PUT postmortem should return postmortemId')

      const draftResponse = await apiRequest(request, 'GET', `${INCIDENTS_API}/${incidentId}/postmortem`, { token })
      expect(draftResponse.status(), 'GET postmortem should succeed after upsert').toBe(200)
      const draft = await readJsonSafe<PostmortemResponse>(draftResponse)
      expect(draft?.item?.summary, 'summary should round-trip decrypted').toBe(summary)
      expect(draft?.item?.rootCause, 'rootCause should round-trip decrypted').toBe(rootCause)
      expect(draft?.item?.status, 'new postmortem should be draft').toBe('draft')
      expect(draft?.item?.publishedAt, 'draft postmortem should not be published').toBeNull()

      const publish = await fetchWithCurrentIncidentLock(request, incidentId, 'POST', `${INCIDENTS_API}/${incidentId}/postmortem/publish`)
      expect(publish.status, 'publish should succeed').toBe(200)
      expect(publish.body?.ok, 'publish should return ok').toBe(true)
      expect(typeof publish.body?.publishedAt, 'publish should return publishedAt').toBe('string')

      const secondPublish = await fetchWithCurrentIncidentLock(request, incidentId, 'POST', `${INCIDENTS_API}/${incidentId}/postmortem/publish`)
      expect(secondPublish.status, 'second publish should be refused').toBe(409)

      const editPublished = await fetchWithCurrentIncidentLock(request, incidentId, 'PUT', `${INCIDENTS_API}/${incidentId}/postmortem`, {
        summary: `${summary} edited`,
      })
      expect(editPublished.status, 'editing a published postmortem should be refused').toBe(409)
    } finally {
      await deleteIncidentIfExists(request, incidentId)
    }
  })

  test('action items create, list in creation order, update status completion timestamps, and delete', async ({ request }) => {
    let incidentId: string | null = null
    try {
      expect(userId, 'admin token should contain a user id').toBeTruthy()
      incidentId = await createIncident(request)
      const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

      const first = await fetchWithCurrentIncidentLock(request, incidentId, 'POST', `${INCIDENTS_API}/${incidentId}/action-items`, {
        title: `First action ${uniqueSuffix()}`,
      })
      expect(first.status, 'title-only action item create should succeed').toBe(200)
      const firstId = expectId(first.body?.actionItemId, 'title-only action item should return actionItemId')

      const secondTitle = `Second action ${uniqueSuffix()}`
      const second = await fetchWithCurrentIncidentLock(request, incidentId, 'POST', `${INCIDENTS_API}/${incidentId}/action-items`, {
        title: secondTitle,
        assigneeUserId: userId,
        dueAt,
      })
      expect(second.status, 'full action item create should succeed').toBe(200)
      const secondId = expectId(second.body?.actionItemId, 'full action item should return actionItemId')

      let items = await listActionItems(request, incidentId)
      expect(items.map((item) => item.id), 'action items should be ordered by creation time').toEqual([firstId, secondId])
      const secondItem = items.find((item) => item.id === secondId)
      expect(secondItem?.title, 'second title should persist').toBe(secondTitle)
      expect(secondItem?.assigneeUserId, 'assignee should persist').toBe(userId)
      expect(secondItem?.dueAt, 'dueAt should persist').toBe(dueAt)

      const inProgress = await fetchWithCurrentIncidentLock(
        request,
        incidentId,
        'PUT',
        `${INCIDENTS_API}/${incidentId}/action-items/${secondId}`,
        { status: 'in_progress' },
      )
      expect(inProgress.status, 'status update to in_progress should succeed').toBe(200)
      items = await listActionItems(request, incidentId)
      expect(items.find((item) => item.id === secondId)?.status, 'status should become in_progress').toBe('in_progress')

      const done = await fetchWithCurrentIncidentLock(
        request,
        incidentId,
        'PUT',
        `${INCIDENTS_API}/${incidentId}/action-items/${secondId}`,
        { status: 'done' },
      )
      expect(done.status, 'status update to done should succeed').toBe(200)
      items = await listActionItems(request, incidentId)
      expect(typeof items.find((item) => item.id === secondId)?.completedAt, 'done should set completedAt').toBe('string')

      const reopen = await fetchWithCurrentIncidentLock(
        request,
        incidentId,
        'PUT',
        `${INCIDENTS_API}/${incidentId}/action-items/${secondId}`,
        { status: 'open' },
      )
      expect(reopen.status, 'status update back to open should succeed').toBe(200)
      items = await listActionItems(request, incidentId)
      expect(items.find((item) => item.id === secondId)?.completedAt, 'open should clear completedAt').toBeNull()

      const remove = await fetchWithCurrentIncidentLock(request, incidentId, 'DELETE', `${INCIDENTS_API}/${incidentId}/action-items/${firstId}`)
      expect(remove.status, 'action item delete should succeed').toBe(200)
      items = await listActionItems(request, incidentId)
      expect(items.some((item) => item.id === firstId), 'deleted action item should disappear from active list').toBe(false)
      expect(items.some((item) => item.id === secondId), 'other action item should remain active').toBe(true)
    } finally {
      await deleteIncidentIfExists(request, incidentId)
    }
  })

  test('postmortem manage endpoints return 403 without incidents.postmortem.manage', async ({ request }) => {
    const stamp = uniqueSuffix()
    const password = 'Incident-Postmortem-1!'
    const email = `qa-incidents-postmortem-${stamp}@acme.com`
    let incidentId: string | null = null
    let roleId: string | null = null
    let limitedUserId: string | null = null
    let limitedToken: string | null = null

    try {
      incidentId = await createIncident(request)
      roleId = await createRoleFixture(request, token, {
        name: `qa_incidents_postmortem_${stamp}`,
        tenantId: scope.tenantId,
      })
      await setRoleAclFeatures(request, token, { roleId, features: ['incidents.postmortem.view'] })
      limitedUserId = await createUserFixture(request, token, {
        email,
        password,
        organizationId: scope.organizationId,
        roles: [roleId],
        name: 'QA Incidents Postmortem View-Only User',
      })
      limitedToken = await getAuthToken(request, email, password)

      const putResponse = await request.fetch(resolveApiUrl(`${INCIDENTS_API}/${incidentId}/postmortem`), {
        method: 'PUT',
        headers: authHeaders(limitedToken),
        data: { summary: 'forbidden' },
      })
      expect(putResponse.status(), 'PUT postmortem without manage should return 403').toBe(403)

      const publishResponse = await request.fetch(resolveApiUrl(`${INCIDENTS_API}/${incidentId}/postmortem/publish`), {
        method: 'POST',
        headers: authHeaders(limitedToken),
      })
      expect(publishResponse.status(), 'publish postmortem without manage should return 403').toBe(403)
    } finally {
      await deleteIncidentIfExists(request, incidentId)
      await deleteUserIfExists(request, token, limitedUserId)
      await deleteRoleIfExists(request, token, roleId)
    }
  })

  test('action-item writes bump the parent aggregate version and stale headers conflict', async ({ request }) => {
    let incidentId: string | null = null
    try {
      incidentId = await createIncident(request)
      const before = await readIncident(request, incidentId)
      const staleUpdatedAt = before.updated_at
      expect(typeof staleUpdatedAt, 'incident detail should expose updated_at for aggregate locking').toBe('string')

      await new Promise((resolve) => setTimeout(resolve, 5))
      const bumpResponse = await request.fetch(resolveApiUrl(`${INCIDENTS_API}/${incidentId}/action-items`), {
        method: 'POST',
        headers: authHeaders(token),
        data: { title: `version bump ${uniqueSuffix()}` },
      })
      expect(bumpResponse.status(), 'headerless action-item write should succeed').toBe(200)

      let after = await readIncident(request, incidentId)
      if (after.updated_at === staleUpdatedAt) {
        await new Promise((resolve) => setTimeout(resolve, 5))
        const secondBump = await request.fetch(resolveApiUrl(`${INCIDENTS_API}/${incidentId}/action-items`), {
          method: 'POST',
          headers: authHeaders(token),
          data: { title: `second version bump ${uniqueSuffix()}` },
        })
        expect(secondBump.status(), 'second action-item write should advance the aggregate version').toBe(200)
        after = await readIncident(request, incidentId)
      }
      expect(after.updated_at, 'action-item write should bump parent incident updated_at').not.toBe(staleUpdatedAt)

      const staleResponse = await request.fetch(resolveApiUrl(`${INCIDENTS_API}/${incidentId}/action-items`), {
        method: 'POST',
        headers: authHeaders(token, staleUpdatedAt as string),
        data: { title: `stale action ${uniqueSuffix()}` },
      })
      expect(staleResponse.status(), 'stale action-item write should be refused').toBe(409)
      const conflict = await readJsonSafe<{ code?: string }>(staleResponse)
      expect(conflict?.code, 'stale action-item write should return the optimistic-lock conflict code').toBe(
        OPTIMISTIC_LOCK_CONFLICT_CODE,
      )
    } finally {
      await deleteIncidentIfExists(request, incidentId)
    }
  })
})
