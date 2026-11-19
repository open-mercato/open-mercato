import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type Interaction = {
  id: string
  entityId: string
  interactionType: string
  authorUserId: string | null
  body: string | null
  status: string
  visibility: string | null
}

async function listInteractions(request: APIRequestContext, token: string, personId: string): Promise<Interaction[]> {
  const response = await apiRequest(request, 'GET', `/api/customers/interactions?entityId=${personId}`, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{ items?: Interaction[] }>(response)
  return body?.items ?? []
}

test('TC-CRM-EMAIL-VISIBILITY-005: private email mutation authorization follows the original row', async ({ request }) => {
  const stamp = `${Date.now()}-${test.info().retry}`
  const roleName = `qa_email_mutation_${stamp}`
  let adminToken: string | null = null
  let ownerToken: string | null = null
  let roleId: string | null = null
  let ownerId: string | null = null
  let managerId: string | null = null
  let personId: string | null = null
  let otherPersonId: string | null = null
  let interactionId: string | null = null
  let conversationShared = false

  try {
    adminToken = await getAuthToken(request, 'admin')
    const scope = getTokenScope(adminToken)
    roleId = await createRoleFixture(request, adminToken, { name: roleName, tenantId: scope.tenantId })
    await setRoleAclFeatures(request, adminToken, {
      roleId,
      features: [
        'customers.people.view',
        'customers.people.manage',
        'customers.interactions.view',
        'customers.interactions.manage',
        'customers.activities.view',
        'customers.activities.manage',
        'customers.email.compose',
        'customers.email.share_conversation',
      ],
    })
    const password = 'Valid1!Pass'
    const ownerEmail = `qa-email-mutation-owner-${stamp}@acme.com`
    const managerEmail = `qa-email-mutation-manager-${stamp}@acme.com`
    ownerId = await createUserFixture(request, adminToken, {
      email: ownerEmail, password, organizationId: scope.organizationId, roles: [roleName],
    })
    managerId = await createUserFixture(request, adminToken, {
      email: managerEmail, password, organizationId: scope.organizationId, roles: [roleName],
    })
    ownerToken = await getAuthToken(request, ownerEmail, password)
    const managerToken = await getAuthToken(request, managerEmail, password)
    personId = await createPersonFixture(request, adminToken, {
      firstName: 'PrivateEmail', lastName: stamp, displayName: `Private email ${stamp}`,
    })
    otherPersonId = await createPersonFixture(request, adminToken, {
      firstName: 'RelinkTarget', lastName: stamp, displayName: `Relink target ${stamp}`,
    })
    const created = await apiRequest(request, 'POST', '/api/customers/interactions', {
      token: ownerToken,
      data: {
        entityId: personId,
        interactionType: 'email',
        title: `Private email mutation ${stamp}`,
        body: 'Original private body',
        status: 'planned',
        visibility: 'private',
      },
    })
    expect(created.status()).toBe(201)
    interactionId = expectId((await readJsonSafe<{ id?: string }>(created))?.id, 'Expected the private email id')

    const actors = [
      { name: 'ordinary manager', token: managerToken, userId: managerId },
      { name: 'wildcard admin', token: adminToken, userId: scope.userId },
    ]
    for (const actor of actors) {
      const attempts = [
        { method: 'PUT', path: '/api/customers/interactions', data: { id: interactionId, authorUserId: actor.userId } },
        { method: 'PUT', path: '/api/customers/interactions', data: { id: interactionId, interactionType: 'note' } },
        { method: 'PUT', path: '/api/customers/interactions', data: { id: interactionId, body: 'Unauthorized edit' } },
        { method: 'PUT', path: '/api/customers/interactions', data: { id: interactionId, status: 'done' } },
        { method: 'PUT', path: '/api/customers/interactions', data: { id: interactionId, entityId: otherPersonId } },
        { method: 'DELETE', path: `/api/customers/interactions?id=${interactionId}`, data: undefined },
        { method: 'POST', path: '/api/customers/interactions/complete', data: { id: interactionId } },
        { method: 'POST', path: '/api/customers/interactions/cancel', data: { id: interactionId } },
      ]
      for (const attempt of attempts) {
        const response = await apiRequest(request, attempt.method, attempt.path, {
          token: actor.token, data: attempt.data,
        })
        expect(response.status(), `${actor.name}: ${attempt.method} ${attempt.path} ${JSON.stringify(attempt.data)}`).toBe(404)
      }
      const legacyAttempts = [
        { method: 'PUT', path: '/api/customers/activities', data: { id: interactionId, authorUserId: actor.userId } },
        { method: 'PUT', path: '/api/customers/activities', data: { id: interactionId, activityType: 'note' } },
        { method: 'DELETE', path: '/api/customers/activities', data: { id: interactionId } },
      ]
      for (const attempt of legacyAttempts) {
        const response = await apiRequest(request, attempt.method, attempt.path, {
          token: actor.token, data: attempt.data,
        })
        if (response.status() === 410) {
          test.info().annotations.push({ type: 'legacy-adapter-disabled', description: `${attempt.method} ${attempt.path}` })
          continue
        }
        expect(response.status(), `${actor.name}: legacy ${attempt.method} ${attempt.path}`).toBe(404)
      }
      expect((await listInteractions(request, actor.token, personId)).some((item) => item.id === interactionId)).toBe(false)
    }
    expect((await listInteractions(request, ownerToken, personId)).find((item) => item.id === interactionId)).toMatchObject({
      entityId: personId, interactionType: 'email', authorUserId: ownerId,
      body: 'Original private body', status: 'planned', visibility: 'private',
    })
    expect((await listInteractions(request, ownerToken, otherPersonId)).some((item) => item.id === interactionId)).toBe(false)

    const ownerEdit = await apiRequest(request, 'PUT', '/api/customers/interactions', {
      token: ownerToken, data: { id: interactionId, body: 'Owner edit' },
    })
    expect(ownerEdit.status()).toBe(200)
    const sharePath = `/api/customers/people/${personId}/email-share`
    const sharedConversation = await apiRequest(request, 'PUT', sharePath, {
      token: ownerToken, data: { shared: true },
    })
    expect(sharedConversation.status()).toBe(200)
    conversationShared = true
    const conversationEdit = await apiRequest(request, 'PUT', '/api/customers/interactions', {
      token: managerToken, data: { id: interactionId, body: 'Team conversation edit' },
    })
    expect(conversationEdit.status()).toBe(200)
    expect((await listInteractions(request, ownerToken, personId)).find((item) => item.id === interactionId)).toMatchObject({
      body: 'Team conversation edit', visibility: 'private', authorUserId: ownerId, interactionType: 'email',
    })

    for (const actor of actors) {
      for (const privacyChange of [{ authorUserId: actor.userId }, { interactionType: 'note' }, { visibility: 'shared' }]) {
        const response = await apiRequest(request, 'PUT', '/api/customers/interactions', {
          token: actor.token, data: { id: interactionId, ...privacyChange },
        })
        expect(response.status(), `${actor.name} cannot change conversation-shared email privacy`).toBe(404)
      }
    }
    const revoke = await apiRequest(request, 'PUT', sharePath, { token: ownerToken, data: { shared: false } })
    expect(revoke.status()).toBe(200)
    conversationShared = false
    const editAfterRevoke = await apiRequest(request, 'PUT', '/api/customers/interactions', {
      token: managerToken, data: { id: interactionId, body: 'Edit after revocation' },
    })
    expect(editAfterRevoke.status()).toBe(404)
    expect((await listInteractions(request, managerToken, personId)).some((item) => item.id === interactionId)).toBe(false)

    const messageShare = await apiRequest(request, 'PUT', '/api/customers/interactions', {
      token: ownerToken, data: { id: interactionId, visibility: 'shared' },
    })
    expect(messageShare.status()).toBe(200)
    const teamEdit = await apiRequest(request, 'PUT', '/api/customers/interactions', {
      token: managerToken, data: { id: interactionId, body: 'Team shared-message edit' },
    })
    expect(teamEdit.status()).toBe(200)
    for (const privacyChange of [{ authorUserId: managerId }, { interactionType: 'note' }, { visibility: 'private' }]) {
      const response = await apiRequest(request, 'PUT', '/api/customers/interactions', {
        token: managerToken, data: { id: interactionId, ...privacyChange },
      })
      expect(response.status(), 'A teammate cannot change shared email privacy').toBe(404)
    }
    expect((await listInteractions(request, ownerToken, personId)).find((item) => item.id === interactionId)).toMatchObject({
      body: 'Team shared-message edit', visibility: 'shared', authorUserId: ownerId, interactionType: 'email',
    })
  } finally {
    if (ownerToken && personId && conversationShared) {
      await apiRequest(request, 'PUT', `/api/customers/people/${personId}/email-share`, {
        token: ownerToken, data: { shared: false },
      }).catch(() => undefined)
    }
    if (ownerToken && interactionId) {
      await deleteEntityIfExists(request, ownerToken, '/api/customers/interactions', interactionId)
    }
    await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId)
    await deleteEntityIfExists(request, adminToken, '/api/customers/people', otherPersonId)
    await deleteUserIfExists(request, adminToken, managerId)
    await deleteUserIfExists(request, adminToken, ownerId)
    await deleteRoleIfExists(request, adminToken, roleId)
  }
})

const schedulingQuery = 'date=2099-08-25&startTime=09%3A00&duration=30&timezoneOffsetMinutes=0'

type ConflictResult = {
  hasConflicts: boolean
  conflicts: Array<{ id: string; title: string | null; type: string }>
}

type SchedulingFixture = {
  ownerId: string
  ownerToken: string
  viewerToken: string
  personId: string
  privateId: string
  privateTitle: string
  sharedId: string
  viewerMeetingId: string
}

async function getConflicts(request: APIRequestContext, token: string, userId?: string): Promise<ConflictResult> {
  const targetQuery = userId ? `&userId=${encodeURIComponent(userId)}` : ''
  const response = await apiRequest(request, 'GET', `/api/customers/interactions/conflicts?${schedulingQuery}${targetQuery}`, { token })
  expect(response.status(), 'The scheduling lookup should succeed').toBe(200)
  const body = await readJsonSafe<{ ok?: boolean; result?: ConflictResult }>(response)
  expect(body?.ok).toBe(true)
  expect(body?.result).toBeDefined()
  return body!.result!
}

async function withSchedulingFixture(
  request: APIRequestContext,
  run: (fixture: SchedulingFixture) => Promise<void>,
): Promise<void> {
  const stamp = randomUUID()
  const adminToken = await getAuthToken(request, 'admin')
  const scope = getTokenScope(adminToken)
  const userIds: string[] = []
  const interactions: Array<{ id: string; token: string }> = []
  let roleId: string | null = null
  let personId: string | null = null
  let ownerToken: string | null = null

  try {
    const roleName = `qa_conflict_visibility_${stamp}`
    roleId = await createRoleFixture(request, adminToken, { name: roleName, tenantId: scope.tenantId })
    await setRoleAclFeatures(request, adminToken, {
      roleId,
      features: [
        'customers.people.view',
        'customers.interactions.view',
        'customers.interactions.manage',
        'customers.email.compose',
        'customers.email.share_conversation',
      ],
    })
    const password = 'Valid1!Pass'
    const ownerEmail = `qa-conflict-owner-${stamp}@example.com`
    const viewerEmail = `qa-conflict-viewer-${stamp}@example.com`
    const ownerId = await createUserFixture(request, adminToken, {
      email: ownerEmail,
      password,
      organizationId: scope.organizationId,
      roles: [roleName],
    })
    userIds.push(ownerId)
    const viewerId = await createUserFixture(request, adminToken, {
      email: viewerEmail,
      password,
      organizationId: scope.organizationId,
      roles: [roleName],
    })
    userIds.push(viewerId)
    ownerToken = await getAuthToken(request, ownerEmail, password)
    const viewerToken = await getAuthToken(request, viewerEmail, password)
    personId = await createPersonFixture(request, adminToken, {
      firstName: 'Scheduling',
      lastName: stamp,
      displayName: `Scheduling privacy ${stamp}`,
    })

    async function createScheduledInteraction(token: string, ownerUserId: string, interactionType: string, title: string, visibility?: string) {
      const response = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: {
          entityId: personId,
          interactionType,
          title,
          visibility,
          status: 'planned',
          scheduledAt: '2099-08-25T09:00:00.000Z',
          durationMinutes: 30,
          ownerUserId,
        },
      })
      const body = await readJsonSafe<{ id?: string }>(response)
      expect(response.status(), 'The scheduled interaction should be created').toBe(201)
      const interactionId = expectId(body?.id, 'The scheduled interaction must have an id')
      interactions.push({ id: interactionId, token })
      return interactionId
    }

    const privateTitle = `Confidential scheduled email ${stamp}`
    const privateId = await createScheduledInteraction(ownerToken, ownerId, 'email', privateTitle, 'private')
    const sharedId = await createScheduledInteraction(ownerToken, ownerId, 'email', `Shared scheduled email ${stamp}`, 'shared')
    const viewerMeetingId = await createScheduledInteraction(viewerToken, viewerId, 'meeting', `Viewer meeting ${stamp}`)
    await run({ ownerId, ownerToken, viewerToken, personId, privateId, privateTitle, sharedId, viewerMeetingId })
  } finally {
    if (ownerToken && personId) {
      await apiRequest(request, 'PUT', `/api/customers/people/${encodeURIComponent(personId)}/email-share`, {
        token: ownerToken,
        data: { shared: false },
      }).catch(() => undefined)
    }
    for (const interaction of interactions.reverse()) {
      await deleteEntityIfExists(request, interaction.token, '/api/customers/interactions', interaction.id)
    }
    await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId)
    for (const userId of userIds.reverse()) await deleteUserIfExists(request, adminToken, userId)
    await deleteRoleIfExists(request, adminToken, roleId)
  }
}

test.describe('TC-CRM-EMAIL-VISIBILITY-005: Scheduling conflict privacy', () => {
  test('defaults to the interactive actor and hides private email during coworker lookup', async ({ request }) => {
    await withSchedulingFixture(request, async (fixture) => {
      const own = await getConflicts(request, fixture.ownerToken)
      expect(own.conflicts.map((conflict) => conflict.id).sort()).toEqual([fixture.privateId, fixture.sharedId].sort())
      expect(own.conflicts.find((conflict) => conflict.id === fixture.privateId)?.title).toBe(fixture.privateTitle)

      const viewer = await getConflicts(request, fixture.viewerToken)
      expect(viewer.conflicts.map((conflict) => conflict.id)).toEqual([fixture.viewerMeetingId])

      const coworker = await getConflicts(request, fixture.viewerToken, fixture.ownerId)
      expect(coworker.conflicts.map((conflict) => conflict.id)).toEqual([fixture.sharedId])
      expect(JSON.stringify(coworker)).not.toContain(fixture.privateTitle)

      const shared = await apiRequest(request, 'PATCH', `/api/customers/interactions/${fixture.privateId}/visibility`, {
        token: fixture.ownerToken,
        data: { visibility: 'shared' },
      })
      expect(shared.status(), 'The owner should be able to share the scheduled email').toBe(200)
      const afterShare = await getConflicts(request, fixture.viewerToken, fixture.ownerId)
      expect(afterShare.conflicts.find((conflict) => conflict.id === fixture.privateId)?.title).toBe(fixture.privateTitle)
    })
  })

  test('honors conversation sharing and immediately hides revoked private email', async ({ request }) => {
    await withSchedulingFixture(request, async (fixture) => {
      const before = await getConflicts(request, fixture.viewerToken, fixture.ownerId)
      expect(before.conflicts.map((conflict) => conflict.id)).toEqual([fixture.sharedId])

      const sharePath = `/api/customers/people/${fixture.personId}/email-share`
      const shared = await apiRequest(request, 'PUT', sharePath, { token: fixture.ownerToken, data: { shared: true } })
      expect(shared.ok(), 'The owner should be able to share the conversation').toBe(true)
      const during = await getConflicts(request, fixture.viewerToken, fixture.ownerId)
      expect(during.conflicts.find((conflict) => conflict.id === fixture.privateId)?.title).toBe(fixture.privateTitle)

      const revoked = await apiRequest(request, 'PUT', sharePath, { token: fixture.ownerToken, data: { shared: false } })
      expect(revoked.ok(), 'The owner should be able to revoke the conversation share').toBe(true)
      const after = await getConflicts(request, fixture.viewerToken, fixture.ownerId)
      expect(after.conflicts.map((conflict) => conflict.id)).toEqual([fixture.sharedId])
      expect(JSON.stringify(after)).not.toContain(fixture.privateTitle)
    })
  })
})
