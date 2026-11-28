import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { createDealFixture, createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { customerTestPassword, uniqueSuffix } from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { expectId, getTokenContext, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { OPTIMISTIC_LOCK_CONFLICT_CODE, OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

export const integrationMeta = { dependsOnModules: ['customers', 'auth', 'directory'] }

const INTERACTIONS = '/api/customers/interactions'
const PEOPLE = '/api/customers/people'
const DEALS = '/api/customers/deals'
const TENANTS = '/api/directory/tenants'

type Interaction = {
  id: string
  entityId: string | null
  dealId: string | null
  organizationId: string
  tenantId: string
  interactionType: string
  status: string
  title: string
  updatedAt: string
}

async function createInteraction(request: APIRequestContext, token: string, data: Record<string, unknown>): Promise<string> {
  const response = await apiRequest(request, 'POST', INTERACTIONS, { token, data })
  expect(response.status(), 'POST should create the interaction').toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, 'The interaction response should contain its id')
}

async function listInteractions(request: APIRequestContext, token: string, params: Record<string, string> = {}): Promise<Interaction[]> {
  const response = await apiRequest(request, 'GET', `${INTERACTIONS}?${new URLSearchParams({ limit: '100', ...params })}`, { token })
  expect(response.status(), 'GET should return the scoped interaction list').toBe(200)
  const body = await readJsonSafe<{ items: Interaction[] }>(response)
  expect(body?.items).toBeInstanceOf(Array)
  return body?.items ?? []
}

async function readInteraction(request: APIRequestContext, token: string, marker: string, id: string): Promise<Interaction> {
  const item = (await listInteractions(request, token, { search: marker })).find((record) => record.id === id)
  expect(item, 'The interaction should be present in the canonical list').toBeDefined()
  return item!
}

async function listTasks(request: APIRequestContext, token: string, params: Record<string, string>) {
  const response = await apiRequest(request, 'GET', `${INTERACTIONS}/tasks?${new URLSearchParams({ all: 'true', ...params })}`, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{ items: Array<{ todoId: string; customer: { id: string | null } }> }>(response)
  expect(body?.items).toBeInstanceOf(Array)
  return body?.items ?? []
}

async function readTaskCount(request: APIRequestContext, token: string, entityId: string): Promise<number | undefined> {
  const response = await apiRequest(request, 'GET', `${INTERACTIONS}/counts?entityId=${entityId}`, { token })
  expect(response.status()).toBe(200)
  return (await readJsonSafe<{ result: { task: number } }>(response))?.result.task
}

async function updateInteraction(request: APIRequestContext, token: string, data: Record<string, unknown>): Promise<void> {
  const response = await apiRequest(request, 'PUT', INTERACTIONS, { token, data })
  expect(response.status(), 'PUT should update the interaction').toBe(200)
}

test('TC-CRM-5935 keeps an internal task in the canonical list through attach and detach', async ({ request }) => {
  const token = await getAuthToken(request, 'admin')
  const scope = getTokenContext(token)
  const marker = `TC-CRM-5935-${uniqueSuffix()}`
  const title = `${marker} internal task`
  let personId: string | null = null
  let dealId: string | null = null
  let interactionId: string | null = null
  try {
    personId = await createPersonFixture(request, token, { firstName: 'Internal', lastName: marker, displayName: marker })
    dealId = await createDealFixture(request, token, { title: `${marker} deal`, personIds: [personId] })
    interactionId = await createInteraction(request, token, { interactionType: 'task', title, status: 'planned' })
    expect(await readInteraction(request, token, marker, interactionId)).toMatchObject({
      id: interactionId, title, entityId: null, dealId: null, ...scope,
    })
    expect(await listInteractions(request, token, { entityId: personId })).toEqual([])
    expect(await listInteractions(request, token, { dealId })).toEqual([])
    expect(await readTaskCount(request, token, personId)).toBe(0)
    expect(await listTasks(request, token, { search: marker })).toEqual([
      expect.objectContaining({ todoId: interactionId, customer: expect.objectContaining({ id: null }) }),
    ])

    await updateInteraction(request, token, { id: interactionId, entityId: personId, dealId })
    expect(await listInteractions(request, token, { entityId: personId })).toEqual([
      expect.objectContaining({ id: interactionId, entityId: personId, dealId }),
    ])
    expect(await readTaskCount(request, token, personId)).toBe(1)
    expect(await listTasks(request, token, { entityId: personId })).toEqual([
      expect.objectContaining({ todoId: interactionId, customer: expect.objectContaining({ id: personId }) }),
    ])

    const newTitle = `${title} edited`
    await updateInteraction(request, token, { id: interactionId, title: newTitle })
    expect(await readInteraction(request, token, marker, interactionId)).toMatchObject({
      id: interactionId, title: newTitle, entityId: personId, dealId,
    })

    await updateInteraction(request, token, { id: interactionId, entityId: null })
    expect(await listInteractions(request, token, { entityId: personId })).toEqual([])
    expect(await listTasks(request, token, { entityId: personId })).toEqual([])
    expect(await readTaskCount(request, token, personId)).toBe(0)
    expect(await listInteractions(request, token, { dealId })).toEqual([
      expect.objectContaining({ id: interactionId, entityId: null, dealId }),
    ])

    await updateInteraction(request, token, { id: interactionId, dealId: null })
    expect(await listInteractions(request, token, { dealId })).toEqual([])
    expect(await readInteraction(request, token, marker, interactionId)).toMatchObject({
      id: interactionId, title: newTitle, entityId: null, dealId: null,
    })
  } finally {
    await deleteEntityIfExists(request, token, INTERACTIONS, interactionId)
    await deleteEntityIfExists(request, token, DEALS, dealId)
    await deleteEntityIfExists(request, token, PEOPLE, personId)
  }
})

test('TC-CRM-5935 enforces versions and runs lifecycle commands on an unlinked activity', async ({ request }) => {
  const token = await getAuthToken(request, 'admin')
  const { userId } = getTokenScope(token)
  const marker = `TC-CRM-5935-${uniqueSuffix()}`
  const slot = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  slot.setUTCHours(10, 0, 0, 0)
  const scheduledAt = slot.toISOString()
  const conflictQuery = new URLSearchParams({
    date: scheduledAt.slice(0, 10), startTime: '10:00', duration: '60', timezoneOffsetMinutes: '0', userId,
  })
  const readConflicts = async () => {
    const response = await apiRequest(request, 'GET', `${INTERACTIONS}/conflicts?${conflictQuery}`, { token })
    expect(response.status()).toBe(200)
    const body = await readJsonSafe<{ result: { conflicts: Array<{ id: string }> } }>(response)
    expect(body?.result.conflicts).toBeInstanceOf(Array)
    return body?.result.conflicts.map((conflict) => conflict.id) ?? []
  }
  let meetingId: string | null = null
  let taskId: string | null = null
  try {
    meetingId = await createInteraction(request, token, {
      entityId: null, interactionType: 'meeting', title: `${marker} meeting`, status: 'planned', scheduledAt,
      durationMinutes: 60, ownerUserId: userId,
    })
    const initial = await readInteraction(request, token, marker, meetingId)
    expect(initial.entityId).toBeNull()
    expect(await readConflicts()).toContain(meetingId)

    const title = `${marker} revised meeting`
    await updateInteraction(request, token, { id: meetingId, title })
    const current = await readInteraction(request, token, marker, meetingId)
    expect(current.updatedAt).not.toBe(initial.updatedAt)
    const staleHeaders = { [OPTIMISTIC_LOCK_HEADER_NAME]: initial.updatedAt }
    const deleteUrl = `${INTERACTIONS}?id=${meetingId}`
    const staleEdit = await apiRequest(request, 'PUT', INTERACTIONS, {
      token, headers: staleHeaders, data: { id: meetingId, title: `${marker} stale meeting` },
    })
    const staleDelete = await apiRequest(request, 'DELETE', deleteUrl, { token, headers: staleHeaders })
    for (const conflict of [staleEdit, staleDelete]) {
      expect(conflict.status()).toBe(409)
      expect(await readJsonSafe(conflict)).toMatchObject({ code: OPTIMISTIC_LOCK_CONFLICT_CODE })
    }
    expect(await readInteraction(request, token, marker, meetingId)).toMatchObject({ title, entityId: null, status: 'planned' })

    const canceled = await apiRequest(request, 'POST', `${INTERACTIONS}/cancel`, { token, data: { id: meetingId } })
    expect(canceled.status()).toBe(200)
    const canceledRecord = await readInteraction(request, token, marker, meetingId)
    expect(canceledRecord).toMatchObject({ entityId: null, status: 'canceled' })
    expect(await readConflicts()).not.toContain(meetingId)

    const removed = await apiRequest(request, 'DELETE', deleteUrl, {
      token, headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: canceledRecord.updatedAt },
    })
    expect(removed.status()).toBe(200)
    expect(await listInteractions(request, token, { search: marker })).toEqual([])
    meetingId = null

    taskId = await createInteraction(request, token, { interactionType: 'task', title: `${marker} task`, status: 'planned' })
    const completed = await apiRequest(request, 'POST', `${INTERACTIONS}/complete`, { token, data: { id: taskId } })
    expect(completed.status()).toBe(200)
    expect(await readInteraction(request, token, marker, taskId)).toMatchObject({ entityId: null, status: 'done' })
  } finally {
    await deleteEntityIfExists(request, token, INTERACTIONS, meetingId)
    await deleteEntityIfExists(request, token, INTERACTIONS, taskId)
  }
})

test('TC-CRM-5935 keeps email interactions attached to a CRM record', async ({ request }) => {
  const token = await getAuthToken(request, 'admin')
  const marker = `TC-CRM-5935-${uniqueSuffix()}`
  const email = { interactionType: 'email', title: `${marker} email` }
  let personId: string | null = null
  let emailId: string | null = null
  let taskId: string | null = null
  let unexpectedId: string | null = null
  try {
    const noParent = await apiRequest(request, 'POST', INTERACTIONS, { token, data: email })
    const rejection = await readJsonSafe<{ id?: string }>(noParent)
    if (noParent.status() === 201) unexpectedId = rejection?.id ?? null
    expect(noParent.status()).toBe(400)
    expect(rejection).toMatchObject({ details: expect.arrayContaining([expect.objectContaining({ path: ['entityId'] })]) })

    personId = await createPersonFixture(request, token, { firstName: 'Internal', lastName: marker, displayName: marker })
    emailId = await createInteraction(request, token, { ...email, entityId: personId })
    taskId = await createInteraction(request, token, { interactionType: 'task', title: `${marker} task` })
    for (const data of [{ id: emailId, entityId: null }, { id: taskId, interactionType: 'email' }]) {
      const denied = await apiRequest(request, 'PUT', INTERACTIONS, { token, data })
      expect(denied.status()).toBe(400)
      expect(await readJsonSafe(denied)).toMatchObject({ fieldErrors: { entityId: expect.any(String) } })
    }
    expect(await readInteraction(request, token, marker, emailId)).toMatchObject({ entityId: personId, interactionType: 'email' })
    expect(await readInteraction(request, token, marker, taskId)).toMatchObject({ entityId: null, interactionType: 'task' })
  } finally {
    await deleteEntityIfExists(request, token, INTERACTIONS, unexpectedId)
    await deleteEntityIfExists(request, token, INTERACTIONS, emailId)
    await deleteEntityIfExists(request, token, INTERACTIONS, taskId)
    await deleteEntityIfExists(request, token, PEOPLE, personId)
  }
})

test('TC-CRM-5935 serializes email conversion and CRM unlinking', async ({ request }) => {
  const token = await getAuthToken(request, 'admin')
  const marker = `TC-CRM-5935-${uniqueSuffix()}`
  let personId: string | null = null
  let interactionId: string | null = null
  try {
    personId = await createPersonFixture(request, token, { firstName: 'Internal', lastName: marker, displayName: marker })
    interactionId = await createInteraction(request, token, {
      interactionType: 'note',
      title: `${marker} concurrent update`,
      entityId: personId,
    })

    const [convert, detach] = await Promise.all([
      apiRequest(request, 'PUT', INTERACTIONS, {
        token, retryTransport: false, data: { id: interactionId, interactionType: 'email' },
      }),
      apiRequest(request, 'PUT', INTERACTIONS, {
        token, retryTransport: false, data: { id: interactionId, entityId: null },
      }),
    ])
    expect([convert.status(), detach.status()].sort()).toEqual([200, 400])
    const rejected = convert.ok() ? detach : convert
    expect(await readJsonSafe(rejected)).toMatchObject({ fieldErrors: { entityId: expect.any(String) } })
    expect(await readInteraction(request, token, marker, interactionId)).toMatchObject(
      convert.ok() ? { interactionType: 'email', entityId: personId } : { interactionType: 'note', entityId: null },
    )
  } finally {
    await deleteEntityIfExists(request, token, INTERACTIONS, interactionId)
    await deleteEntityIfExists(request, token, PEOPLE, personId)
  }
})

for (const scope of ['organization', 'tenant'] as const) {
  test(`TC-CRM-5935 restricts unlinked activities and CRM references across ${scope} boundaries`, async ({ request }) => {
    const admin = await getAuthToken(request, 'admin')
    const superadmin = await getAuthToken(request, 'superadmin')
    const home = getTokenContext(admin)
    const marker = `TC-CRM-5935-${uniqueSuffix()}`
    const email = `${marker.toLowerCase()}@example.com`
    const password = customerTestPassword()
    const task = { interactionType: 'task', status: 'planned' }
    let tenantId: string | null = null
    let organizationId: string | null = null
    let userId: string | null = null
    let otherToken: string | null = null
    let otherId: string | null = null
    let homeId: string | null = null
    let personId: string | null = null
    let dealId: string | null = null
    const unexpectedIds: string[] = []
    try {
      if (scope === 'tenant') {
        const response = await apiRequest(request, 'POST', TENANTS, { token: superadmin, data: { name: marker } })
        expect(response.status()).toBe(201)
        const body = await readJsonSafe<{ id?: string }>(response)
        tenantId = expectId(body?.id, 'The other tenant should have an id')
      }
      organizationId = await createOrganizationFixture(request, superadmin, { name: marker, tenantId: tenantId ?? home.tenantId })
      userId = await createUserFixture(request, superadmin, { email, password, organizationId, roles: [] })
      const acl = await apiRequest(request, 'PUT', '/api/auth/users/acl', {
        token: superadmin,
        data: { userId, tenantId: tenantId ?? home.tenantId, organizations: [organizationId], features: ['customers.*'] },
      })
      expect(acl.status()).toBe(200)
      otherToken = await withCredentialIsolatedRequest((loginRequest) => getAuthToken(loginRequest, email, password))
      const other = getTokenContext(otherToken)
      expect(other).toEqual({ organizationId, tenantId: tenantId ?? home.tenantId })

      personId = await createPersonFixture(request, admin, { firstName: 'Internal', lastName: marker, displayName: marker })
      dealId = await createDealFixture(request, admin, { title: `${marker} deal`, personIds: [personId] })
      homeId = await createInteraction(request, admin, { ...task, title: `${marker} home` })
      otherId = await createInteraction(request, otherToken, { ...task, title: `${marker} other` })
      expect(await listInteractions(request, otherToken, { search: marker })).toEqual([
        expect.objectContaining({ id: otherId, entityId: null, ...other }),
      ])
      expect(await listTasks(request, otherToken, { search: marker })).toEqual([
        expect.objectContaining({ todoId: otherId }),
      ])

      const deniedOrg = await apiRequest(request, 'POST', INTERACTIONS, {
        token: otherToken, data: { ...task, title: `${marker} denied`, organizationId: home.organizationId },
      })
      if (deniedOrg.status() === 201) {
        const body = await readJsonSafe<{ id?: string }>(deniedOrg)
        if (body?.id) unexpectedIds.push(body.id)
      }
      expect([403, 404]).toContain(deniedOrg.status())
      const deniedWrite = await apiRequest(request, 'PUT', INTERACTIONS, {
        token: otherToken, data: { id: homeId, title: `${marker} forbidden update` },
      })
      expect([403, 404]).toContain(deniedWrite.status())
      for (const [reference, status] of [[{ entityId: personId }, 404], [{ dealId }, 400]] as const) {
        const deniedReference = await apiRequest(request, 'PUT', INTERACTIONS, {
          token: otherToken, data: { id: otherId, ...reference },
        })
        expect(deniedReference.status()).toBe(status)
      }
      expect(await readInteraction(request, otherToken, marker, otherId)).toMatchObject({ entityId: null, dealId: null })
    } finally {
      for (const id of unexpectedIds) {
        await deleteEntityIfExists(request, otherToken, INTERACTIONS, id)
        await deleteEntityIfExists(request, admin, INTERACTIONS, id)
      }
      await deleteEntityIfExists(request, otherToken, INTERACTIONS, otherId)
      await deleteEntityIfExists(request, admin, INTERACTIONS, homeId)
      await deleteEntityIfExists(request, admin, DEALS, dealId)
      await deleteEntityIfExists(request, admin, PEOPLE, personId)
      await deleteUserIfExists(request, superadmin, userId)
      await deleteOrganizationIfExists(request, superadmin, organizationId)
      await deleteEntityIfExists(request, superadmin, TENANTS, tenantId)
    }
  })
}
