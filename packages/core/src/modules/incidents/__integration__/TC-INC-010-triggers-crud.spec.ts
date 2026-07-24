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
  deleteGeneralEntityIfExists,
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

const TRIGGERS_API = '/api/incidents/triggers'
const SEVERITIES_API = '/api/incidents/severities'
const TYPES_API = '/api/incidents/types'
const EVENTS_API = '/api/events?excludeTriggerExcluded=true'
const BASE_URL = process.env.BASE_URL?.trim() || ''
const TEST_PASSWORD = 'Incident-Triggers-1!'

type Scope = {
  organizationId: string
  tenantId: string
}

type ListResponse<T> = {
  items?: T[]
}

type EventDefinition = {
  id: string
  label?: string | null
  module?: string | null
  excludeFromTriggers?: boolean | null
}

type TriggerRecord = {
  id: string
  event_id?: string | null
  is_enabled?: boolean | null
  severity_key?: string | null
  type_key?: string | null
  updated_at?: string | null
}

type CatalogRecord = {
  id: string
  key?: string | null
  label?: string | null
  is_active?: boolean | null
}

let token = ''
let scope: Scope
const createdTriggerIds = new Set<string>()

function resolveApiUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

function authHeaders(authToken: string, lockValue?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${authToken}`,
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

function scopeCookie(tenantId: string, organizationId: string | null): string {
  return `om_selected_tenant=${encodeURIComponent(tenantId)}; om_selected_org=${encodeURIComponent(organizationId ?? '__all__')}`
}

async function apiRequestWithCookie(
  request: APIRequestContext,
  method: string,
  path: string,
  options: { token: string; cookie: string; data?: unknown },
) {
  return request.fetch(resolveApiUrl(path), {
    method,
    headers: {
      Authorization: `Bearer ${options.token}`,
      'Content-Type': 'application/json',
      Cookie: options.cookie,
    },
    data: options.data,
  })
}

async function createTenantFixture(request: APIRequestContext, authToken: string, name: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/directory/tenants', {
    token: authToken,
    data: { name },
  })
  expect(response.status(), 'POST /api/directory/tenants should return 201').toBe(201)
  const body = await readJsonSafe<{ id?: unknown }>(response)
  return expectId(body?.id, 'tenant creation response should include id')
}

async function createOrganizationInTenant(
  request: APIRequestContext,
  authToken: string,
  tenantId: string,
  name: string,
): Promise<string> {
  const response = await apiRequestWithCookie(request, 'POST', '/api/directory/organizations', {
    token: authToken,
    cookie: scopeCookie(scope.tenantId, scope.organizationId),
    data: { tenantId, name },
  })
  expect(response.status(), 'POST /api/directory/organizations should return 201').toBe(201)
  const body = await readJsonSafe<{ id?: unknown }>(response)
  return expectId(body?.id, 'organization creation response should include id')
}

async function setRoleAclFeaturesForTenant(
  request: APIRequestContext,
  authToken: string,
  input: { roleId: string; tenantId: string; features: string[]; organizations?: string[] | null },
): Promise<void> {
  const response = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
    token: authToken,
    data: {
      roleId: input.roleId,
      tenantId: input.tenantId,
      features: input.features,
      organizations: input.organizations ?? null,
    },
  })
  expect(response.status(), 'PUT /api/auth/roles/acl should return 200').toBe(200)
  const body = await readJsonSafe<{ ok?: boolean }>(response)
  expect(body?.ok, 'role ACL update should report ok=true').toBe(true)
}

async function fetchEvents(request: APIRequestContext): Promise<EventDefinition[]> {
  const response = await apiRequest(request, 'GET', EVENTS_API, { token })
  expect(response.status(), 'GET /api/events should succeed').toBe(200)
  const body = await readJsonSafe<{ data?: EventDefinition[] }>(response)
  return (body?.data ?? []).filter((event) => {
    const moduleId = event.module ?? event.id.split('.')[0]
    return event.id && moduleId !== 'incidents' && !event.id.startsWith('incidents.') && event.excludeFromTriggers !== true
  })
}

async function fetchUsedEventIds(request: APIRequestContext): Promise<Set<string>> {
  const response = await apiRequest(request, 'GET', `${TRIGGERS_API}?page=1&pageSize=100`, { token })
  expect(response.status(), 'GET /api/incidents/triggers should succeed').toBe(200)
  const body = await readJsonSafe<ListResponse<TriggerRecord>>(response)
  return new Set(itemsFrom(body).map((trigger) => trigger.event_id).filter((value): value is string => !!value))
}

async function pickUnusedEvents(request: APIRequestContext, count: number): Promise<EventDefinition[]> {
  const [events, used] = await Promise.all([fetchEvents(request), fetchUsedEventIds(request)])
  const picked = events.filter((event) => !used.has(event.id)).slice(0, count)
  expect(picked.length, `at least ${count} unused non-incidents events should exist`).toBeGreaterThanOrEqual(count)
  return picked
}

async function fetchFirstCatalogKey(request: APIRequestContext, path: string): Promise<string> {
  const response = await apiRequest(request, 'GET', `${path}?isActive=true&pageSize=100`, { token })
  expect(response.status(), `GET ${path} should succeed`).toBe(200)
  const body = await readJsonSafe<ListResponse<CatalogRecord>>(response)
  const item = itemsFrom(body).find((record) => typeof record.key === 'string' && record.key.length > 0)
  expect(item, `${path} should expose at least one keyed catalog record`).toBeTruthy()
  return item!.key!
}

async function createTrigger(
  request: APIRequestContext,
  input: { eventId: string; isEnabled?: boolean; severityKey?: string | null; typeKey?: string | null },
): Promise<string> {
  const response = await apiRequest(request, 'POST', TRIGGERS_API, {
    token,
    data: {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      eventId: input.eventId,
      isEnabled: input.isEnabled ?? true,
      severityKey: input.severityKey ?? null,
      typeKey: input.typeKey ?? null,
      conditions: null,
    },
  })
  expect(response.status(), 'POST /api/incidents/triggers should create a trigger').toBe(201)
  const body = await readJsonSafe<{ id?: unknown }>(response)
  const id = expectId(body?.id, 'trigger creation response should include id')
  createdTriggerIds.add(id)
  return id
}

async function readTrigger(request: APIRequestContext, id: string, authToken = token): Promise<TriggerRecord | null> {
  const response = await apiRequest(request, 'GET', `${TRIGGERS_API}?id=${encodeURIComponent(id)}`, { token: authToken })
  expect(response.status(), 'GET /api/incidents/triggers?id=... should succeed').toBe(200)
  const body = await readJsonSafe<ListResponse<TriggerRecord>>(response)
  return itemsFrom(body).find((trigger) => trigger.id === id) ?? null
}

async function deleteTriggerIfExists(request: APIRequestContext, id: string | null, authToken = token): Promise<void> {
  if (!authToken || !id) return
  try {
    await apiRequest(request, 'DELETE', `${TRIGGERS_API}?id=${encodeURIComponent(id)}`, { token: authToken })
  } catch {
    // Cleanup must not hide the primary assertion failure.
  } finally {
    createdTriggerIds.delete(id)
  }
}

async function putTriggerWithLock(
  request: APIRequestContext,
  id: string,
  data: Record<string, unknown>,
  lockValue: string,
) {
  return request.fetch(resolveApiUrl(TRIGGERS_API), {
    method: 'PUT',
    headers: authHeaders(token, lockValue),
    data: {
      id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      ...data,
    },
  })
}

test.describe('TC-INC-010: Incident trigger CRUD API', () => {
  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin')
    scope = getTokenContext(token)
  })

  test.afterAll(async ({ request }) => {
    for (const id of Array.from(createdTriggerIds)) {
      await deleteTriggerIfExists(request, id)
    }
  })

  test('creates, lists, updates, filters by ids, rejects duplicates, and deletes triggers', async ({ request }) => {
    const [eventOne, eventTwo] = await pickUnusedEvents(request, 2)
    const severityKey = await fetchFirstCatalogKey(request, SEVERITIES_API)
    const typeKey = await fetchFirstCatalogKey(request, TYPES_API)
    let triggerOneId: string | null = null
    let triggerTwoId: string | null = null

    try {
      triggerOneId = await createTrigger(request, {
        eventId: eventOne.id,
        severityKey,
        typeKey,
      })
      triggerTwoId = await createTrigger(request, {
        eventId: eventTwo.id,
        severityKey,
        typeKey,
      })

      const listResponse = await apiRequest(
        request,
        'GET',
        `${TRIGGERS_API}?eventId=${encodeURIComponent(eventOne.id)}`,
        { token },
      )
      expect(listResponse.status(), 'GET /api/incidents/triggers?eventId=... should succeed').toBe(200)
      const list = await readJsonSafe<ListResponse<TriggerRecord>>(listResponse)
      expect(itemsFrom(list).some((trigger) => trigger.id === triggerOneId), 'created trigger should list by eventId').toBe(true)

      const idsResponse = await apiRequest(request, 'GET', `${TRIGGERS_API}?ids=${encodeURIComponent(triggerOneId)}`, { token })
      expect(idsResponse.status(), 'GET /api/incidents/triggers?ids=... should succeed').toBe(200)
      const idsBody = await readJsonSafe<ListResponse<TriggerRecord>>(idsResponse)
      const ids = itemsFrom(idsBody).map((trigger) => trigger.id)
      expect(ids, 'ids filter should include the requested trigger').toContain(triggerOneId)
      expect(ids, 'ids filter should exclude unrequested triggers').not.toContain(triggerTwoId)

      const updateResponse = await apiRequest(request, 'PUT', TRIGGERS_API, {
        token,
        data: {
          id: triggerOneId,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          isEnabled: false,
        },
      })
      expect(updateResponse.status(), 'PUT /api/incidents/triggers should update a trigger').toBe(200)
      const updated = await readTrigger(request, triggerOneId)
      expect(updated?.is_enabled, 'updated trigger should persist isEnabled=false').toBe(false)

      const duplicateResponse = await apiRequest(request, 'POST', TRIGGERS_API, {
        token,
        data: {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          eventId: eventOne.id,
          isEnabled: true,
          severityKey,
          typeKey,
          conditions: null,
        },
      })
      expect(
        duplicateResponse.status(),
        `second trigger for same eventId should be rejected with a 4xx, got ${duplicateResponse.status()}`,
      ).toBeGreaterThanOrEqual(400)
      expect(duplicateResponse.status(), 'duplicate rejection should stay in the client-error range').toBeLessThan(500)

      const deleteResponse = await apiRequest(request, 'DELETE', `${TRIGGERS_API}?id=${encodeURIComponent(triggerOneId)}`, { token })
      expect(deleteResponse.status(), 'DELETE /api/incidents/triggers should delete a trigger').toBe(200)
      createdTriggerIds.delete(triggerOneId)
      triggerOneId = null
      expect(await readTrigger(request, ids[0]), 'deleted trigger should disappear from list/detail').toBeNull()
    } finally {
      await deleteTriggerIfExists(request, triggerOneId)
      await deleteTriggerIfExists(request, triggerTwoId)
    }
  })

  test('validates blank and self-module event ids', async ({ request }) => {
    for (const eventId of ['', 'incidents.incident.created']) {
      const response = await apiRequest(request, 'POST', TRIGGERS_API, {
        token,
        data: {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          eventId,
          isEnabled: true,
          conditions: null,
        },
      })
      expect(response.status(), `eventId=${JSON.stringify(eventId)} should be rejected`).toBe(400)
    }
  })

  test('requires incidents.settings.manage', async ({ request }) => {
    const stamp = uniqueSuffix()
    const roleName = `qa_inc_triggers_view_${stamp}`
    const email = `qa-inc-triggers-view-${stamp}@acme.com`
    let roleId: string | null = null
    let userId: string | null = null
    let limitedToken: string | null = null

    try {
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
        name: 'QA Incidents Trigger Limited User',
      })
      limitedToken = await getAuthToken(request, email, TEST_PASSWORD)

      const denied = await apiRequest(request, 'POST', TRIGGERS_API, {
        token: limitedToken,
        data: {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          eventId: 'data_sync.run.completed',
          isEnabled: true,
        },
      })
      expect(denied.status(), 'user without incidents.settings.manage should receive 403').toBe(403)
    } finally {
      await deleteUserIfExists(request, token, userId)
      await deleteRoleIfExists(request, token, roleId)
    }
  })

  test('does not expose tenant A triggers to tenant B', async ({ request }) => {
    const superToken = await getAuthToken(request, 'superadmin')
    const [event] = await pickUnusedEvents(request, 1)
    const stamp = uniqueSuffix()
    let tenantBId: string | null = null
    let orgBId: string | null = null
    let roleBId: string | null = null
    let userBId: string | null = null
    let triggerAId: string | null = null

    try {
      triggerAId = await createTrigger(request, { eventId: event.id })

      tenantBId = await createTenantFixture(request, superToken, `TC-INC-010 Tenant B ${stamp}`)
      orgBId = await createOrganizationInTenant(request, superToken, tenantBId, `TC-INC-010 Org B ${stamp}`)
      roleBId = await createRoleFixture(request, superToken, {
        name: `TC-INC-010 Tenant B Role ${stamp}`,
        tenantId: tenantBId,
      })
      await setRoleAclFeaturesForTenant(request, superToken, {
        roleId: roleBId,
        tenantId: tenantBId,
        features: ['incidents.settings.manage'],
        organizations: null,
      })
      userBId = await createUserFixture(request, superToken, {
        email: `qa-inc-triggers-tenant-b-${stamp}@acme.com`,
        password: TEST_PASSWORD,
        organizationId: orgBId,
        roles: [roleBId],
        name: 'QA Incidents Trigger Tenant B User',
      })
      const tenantBToken = await getAuthToken(request, `qa-inc-triggers-tenant-b-${stamp}@acme.com`, TEST_PASSWORD)
      const tenantBScope = getTokenContext(tenantBToken)
      expect(tenantBScope.tenantId, 'tenant B token should carry tenant B').toBe(tenantBId)

      const response = await apiRequest(
        request,
        'GET',
        `${TRIGGERS_API}?eventId=${encodeURIComponent(event.id)}&ids=${encodeURIComponent(triggerAId)}`,
        { token: tenantBToken },
      )
      expect(response.status(), 'tenant B trigger list should succeed').toBe(200)
      const body = await readJsonSafe<ListResponse<TriggerRecord>>(response)
      expect(itemsFrom(body).some((trigger) => trigger.id === triggerAId), 'tenant B must not see tenant A trigger').toBe(false)
    } finally {
      await deleteTriggerIfExists(request, triggerAId)
      await deleteUserIfExists(request, superToken, userBId)
      await deleteRoleIfExists(request, superToken, roleBId)
      await deleteGeneralEntityIfExists(request, superToken, '/api/directory/organizations', orgBId)
      await deleteGeneralEntityIfExists(request, superToken, '/api/directory/tenants', tenantBId)
    }
  })

  test('rejects stale trigger updates with optimistic-lock 409', async ({ request }) => {
    const [event] = await pickUnusedEvents(request, 1)
    let triggerId: string | null = null

    try {
      triggerId = await createTrigger(request, { eventId: event.id, isEnabled: true })
      const before = await readTrigger(request, triggerId)
      const staleUpdatedAt = before?.updated_at
      expect(typeof staleUpdatedAt, 'trigger detail should expose updated_at for locking').toBe('string')

      await new Promise((resolve) => setTimeout(resolve, 10))
      const updateResponse = await putTriggerWithLock(request, triggerId, { isEnabled: false }, staleUpdatedAt as string)
      expect(updateResponse.status(), 'PUT with the current lock should succeed').toBe(200)

      let after = await readTrigger(request, triggerId)
      if (after?.updated_at === staleUpdatedAt) {
        await new Promise((resolve) => setTimeout(resolve, 10))
        const bumpResponse = await apiRequest(request, 'PUT', TRIGGERS_API, {
          token,
          data: {
            id: triggerId,
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            isEnabled: true,
          },
        })
        expect(bumpResponse.status(), 'headerless version bump should still succeed').toBe(200)
        after = await readTrigger(request, triggerId)
      }
      expect(after?.updated_at, 'successful update should advance updated_at').not.toBe(staleUpdatedAt)

      const conflictResponse = await putTriggerWithLock(request, triggerId, { isEnabled: true }, staleUpdatedAt as string)
      expect(conflictResponse.status(), 'stale trigger PUT should be refused').toBe(409)
      const conflict = await readJsonSafe<{ code?: string }>(conflictResponse)
      expect(conflict?.code, 'stale trigger PUT should return optimistic-lock conflict code').toBe(
        OPTIMISTIC_LOCK_CONFLICT_CODE,
      )
    } finally {
      await deleteTriggerIfExists(request, triggerId)
    }
  })
})
