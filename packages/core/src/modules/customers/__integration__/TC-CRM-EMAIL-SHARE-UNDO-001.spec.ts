import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { Client } from 'pg'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  expectOperation,
  redoByLogId,
  skipIfUndoTestsDisabled,
  undoByToken,
  type Operation,
} from '@open-mercato/core/helpers/integration/undoHarness'

type ShareRow = {
  id: string
  organization_id: string
  tenant_id: string
  person_entity_id: string
  owner_user_id: string
  shared_by_user_id: string
  created_at: string
  updated_at: string | null
  deleted_at: string | null
}

type ShareFixture = {
  adminToken: string
  database: Client
  organizationId: string
  tenantId: string
  personId: string
  createOperation: Operation
  owners: Array<{ id: string; token: string; interactionId: string }>
}

async function withShareFixture(
  request: APIRequestContext,
  ownerCount: number,
  run: (fixture: ShareFixture) => Promise<void>,
): Promise<void> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('[internal] DATABASE_URL is required for TC-CRM-EMAIL-SHARE-UNDO-001')
  const database = new Client({ connectionString })
  await database.connect()
  let adminToken: string | null = null
  let roleId: string | null = null
  let personId: string | null = null
  let fixtureScope: { organizationId: string; tenantId: string } | null = null
  const userIds: string[] = []

  try {
    adminToken = await getAuthToken(request, 'admin')
    const { organizationId, tenantId } = getTokenContext(adminToken)
    fixtureScope = { organizationId, tenantId }
    const suffix = randomUUID()
    const roleName = `qa_share_undo_${suffix.replaceAll('-', '')}`
    roleId = await createRoleFixture(request, adminToken, { name: roleName, tenantId })
    await setRoleAclFeatures(request, adminToken, { roleId, features: ['customers.*', 'audit_logs.*'] })

    const created = await apiRequest(request, 'POST', '/api/customers/people', {
      token: adminToken,
      data: { firstName: 'ShareUndo', lastName: suffix, displayName: `ShareUndo ${suffix}` },
    })
    expect(created.status(), 'Person fixture should be created').toBe(201)
    const createdBody = await readJsonSafe<{ id?: string }>(created)
    personId = expectId(createdBody?.id, 'Person fixture should have an id')
    const createOperation = expectOperation(created, 'customers.people.create')
    const owners: ShareFixture['owners'] = []

    for (let ownerIndex = 0; ownerIndex < ownerCount; ownerIndex += 1) {
      const email = `share-undo-${suffix}-${ownerIndex}@example.test`
      const password = `Fixture-${randomUUID()}!`
      const userId = await createUserFixture(request, adminToken, {
        email,
        password,
        organizationId,
        roles: [roleName],
        name: `Share undo owner ${ownerIndex}`,
      })
      userIds.push(userId)
      const ownerToken = await getAuthToken(request, email, password)
      const interaction = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token: ownerToken,
        data: {
          entityId: personId,
          interactionType: 'email',
          title: `Private conversation ${suffix} ${ownerIndex}`,
          status: 'done',
          occurredAt: new Date().toISOString(),
          visibility: 'private',
        },
      })
      expect(interaction.status(), 'Private email fixture should be created').toBe(201)
      const interactionBody = await readJsonSafe<{ id?: string }>(interaction)
      owners.push({
        id: userId,
        token: ownerToken,
        interactionId: expectId(interactionBody?.id, 'Private email fixture should have an id'),
      })
    }

    await run({ adminToken, database, organizationId, tenantId, personId, createOperation, owners })
  } finally {
    try {
      if (adminToken && personId && fixtureScope) {
        await database.query(
          'delete from customer_email_conversation_shares where person_entity_id = $1 and tenant_id = $2 and organization_id = $3',
          [personId, fixtureScope.tenantId, fixtureScope.organizationId],
        )
        const response = await apiRequest(request, 'DELETE', `/api/customers/people?id=${personId}`, { token: adminToken })
        expect([200, 404], 'Person fixture cleanup should succeed or find the Person already removed').toContain(response.status())
      }
    } finally {
      try {
        for (const userId of userIds) await deleteUserIfExists(request, adminToken, userId)
        await deleteRoleIfExists(request, adminToken, roleId)
      } finally {
        await database.end()
      }
    }
  }
}

async function readShares(fixture: ShareFixture): Promise<ShareRow[]> {
  const result = await fixture.database.query<{ share: ShareRow }>(
    'select to_jsonb(share) as share from customer_email_conversation_shares share where person_entity_id = $1 and tenant_id = $2 and organization_id = $3 order by id',
    [fixture.personId, fixture.tenantId, fixture.organizationId],
  )
  return result.rows.map((row) => row.share)
}

async function setShared(
  request: APIRequestContext,
  fixture: ShareFixture,
  ownerIndex: number,
  shared: boolean,
): Promise<void> {
  const response = await apiRequest(request, 'PUT', `/api/customers/people/${fixture.personId}/email-share`, {
    token: fixture.owners[ownerIndex].token,
    data: { shared },
  })
  expect(response.status(), `Conversation ${shared ? 'share' : 'revoke'} should succeed`).toBe(200)
}

async function expectShareState(
  request: APIRequestContext,
  fixture: ShareFixture,
  expectedShares: ShareRow[],
): Promise<void> {
  const activeOwners = expectedShares.filter((share) => share.deleted_at === null).map((share) => share.owner_user_id).sort()
  for (const owner of fixture.owners) {
    const response = await apiRequest(request, 'GET', `/api/customers/people/${fixture.personId}/email-share`, { token: owner.token })
    expect(response.status(), 'Restored Person should expose its share state').toBe(200)
    const state = await readJsonSafe<{ sharedByMe?: boolean }>(response)
    expect(state?.sharedByMe, 'Only active share rows should grant the owner share state').toBe(activeOwners.includes(owner.id))
  }
  const response = await apiRequest(request, 'GET', `/api/customers/people/${fixture.personId}/email-share`, { token: fixture.adminToken })
  expect(response.status()).toBe(200)
  const state = await readJsonSafe<{ sharedBy?: Array<{ userId: string }> }>(response)
  expect((state?.sharedBy ?? []).map((owner) => owner.userId).sort(), 'Revoked history must not become an active grant').toEqual(activeOwners)
}

async function expectRemoved(request: APIRequestContext, fixture: ShareFixture): Promise<void> {
  expect(await readShares(fixture), 'Hard deletion should remove active and revoked share rows').toEqual([])
  const response = await apiRequest(request, 'GET', `/api/customers/people/${fixture.personId}`, { token: fixture.adminToken })
  expect(response.status(), 'Deleted Person should no longer exist').toBe(404)
}

async function undo(request: APIRequestContext, token: string, undoToken: string): Promise<void> {
  const response = await undoByToken(request, token, undoToken)
  expect(response.status(), 'Undo should succeed').toBe(200)
  expect((await readJsonSafe<{ ok?: boolean }>(response))?.ok).toBe(true)
}

async function expectDeleteRoundTrip(
  request: APIRequestContext,
  fixture: ShareFixture,
  expectedShares: ShareRow[],
): Promise<void> {
  await expectShareState(request, fixture, expectedShares)
  const removed = await apiRequest(request, 'DELETE', `/api/customers/people?id=${fixture.personId}`, { token: fixture.adminToken })
  expect(removed.status(), 'Person deletion should succeed even when conversation shares exist').toBe(200)
  const deleteOperation = expectOperation(removed, 'customers.people.delete')
  await expectRemoved(request, fixture)

  await undo(request, fixture.adminToken, deleteOperation.undoToken)
  expect(await readShares(fixture), 'Undo should restore every share column exactly').toEqual(expectedShares)
  await expectShareState(request, fixture, expectedShares)

  const redone = await redoByLogId(request, fixture.adminToken, deleteOperation.logId)
  expect(redone.status(), 'Redo should delete the Person and its shares again').toBe(200)
  const redoOperation = expectOperation(redone, 'customers.people.delete redo')
  await expectRemoved(request, fixture)

  await undo(request, fixture.adminToken, redoOperation.undoToken)
  expect(await readShares(fixture), 'Second undo should preserve share identities, dates, and revoked state').toEqual(expectedShares)
  await expectShareState(request, fixture, expectedShares)
}

test.describe('TC-CRM-EMAIL-SHARE-UNDO-001: conversation shares follow Person deletion', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('active share survives delete → undo → redo → undo without changing its row', async ({ request }) => {
    await withShareFixture(request, 1, async (fixture) => {
      await setShared(request, fixture, 0, true)
      const shares = await readShares(fixture)
      expect(shares).toHaveLength(1)
      expect(shares[0].deleted_at).toBeNull()
      await expectDeleteRoundTrip(request, fixture, shares)
    })
  })

  test('revoked share survives delete → undo → redo → undo without granting access', async ({ request }) => {
    await withShareFixture(request, 1, async (fixture) => {
      await setShared(request, fixture, 0, true)
      await setShared(request, fixture, 0, false)
      const shares = await readShares(fixture)
      expect(shares).toHaveLength(1)
      expect(shares[0].deleted_at).not.toBeNull()
      await expectDeleteRoundTrip(request, fixture, shares)
    })
  })

  test('multiple owners retain revoked and re-shared history, including a null version', async ({ request }) => {
    await withShareFixture(request, 2, async (fixture) => {
      await setShared(request, fixture, 0, true)
      await setShared(request, fixture, 0, false)
      await setShared(request, fixture, 0, true)
      await setShared(request, fixture, 1, true)
      await setShared(request, fixture, 1, false)
      const history = await readShares(fixture)
      expect(history).toHaveLength(3)
      const revoked = history.find((share) => share.owner_user_id === fixture.owners[0].id && share.deleted_at !== null)
      expect(revoked, 'Re-sharing should retain the original revoked row').toBeTruthy()
      await fixture.database.query(
        'update customer_email_conversation_shares set updated_at = null where id = $1 and person_entity_id = $2 and tenant_id = $3 and organization_id = $4',
        [revoked?.id, fixture.personId, fixture.tenantId, fixture.organizationId],
      )
      const shares = await readShares(fixture)
      expect(shares.find((share) => share.id === revoked?.id)?.updated_at).toBeNull()
      expect(shares.filter((share) => share.deleted_at === null)).toHaveLength(1)
      await expectDeleteRoundTrip(request, fixture, shares)
    })
  })

  test('undoing Person creation removes active and revoked conversation shares', async ({ request }) => {
    await withShareFixture(request, 1, async (fixture) => {
      await setShared(request, fixture, 0, true)
      await setShared(request, fixture, 0, false)
      await setShared(request, fixture, 0, true)
      const shares = await readShares(fixture)
      expect(shares).toHaveLength(2)
      expect(shares.filter((share) => share.deleted_at === null)).toHaveLength(1)
      const removedInteraction = await fixture.database.query(
        'delete from customer_interactions where id = $1 and entity_id = $2 and tenant_id = $3 and organization_id = $4',
        [fixture.owners[0].interactionId, fixture.personId, fixture.tenantId, fixture.organizationId],
      )
      expect(removedInteraction.rowCount, 'Remove only the test-created email to isolate create undo share cleanup').toBe(1)
      await undo(request, fixture.adminToken, fixture.createOperation.undoToken)
      await expectRemoved(request, fixture)
    })
  })
})
