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
