import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createCompanyFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  deleteChannelIfExists,
  isChannelSeedingAvailable,
  seedConnectedChannel,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectOperation, redoOk, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'

/**
 * TC-CRM-EMAIL-UNDO-001: deleting a Person or Company and undoing the delete restores
 * every interaction row exactly as it was — email channel linkage, email visibility and
 * the meeting metadata (location, duration, participants, recurrence, reminders, guest
 * permissions, linked records, pinned).
 *
 * Rows are compared column by column straight from Postgres (title/body are encrypted at
 * rest, so they are compared through the API instead). `updated_at` is only required not to
 * move backwards.
 *
 * A teammate who could not read the private email before the delete must still be unable to
 * read it after undo and after redo → undo.
 *
 * Mailbox ingestion links email to People only, so the Company case sets the source-linked
 * columns of its email row directly: the undo path must carry them whatever wrote them.
 */

const APP_ROOT = process.env.OM_TEST_APP_ROOT?.trim()
  ? path.resolve(process.env.OM_TEST_APP_ROOT as string)
  : path.resolve(process.cwd(), 'apps/mercato')

if (!process.env.OM_TEST_APP_ROOT?.trim()) {
  loadEnv({ path: path.resolve(APP_ROOT, '.env') })
  process.env.QUEUE_BASE_DIR = path.resolve(APP_ROOT, '.mercato/queue')
}

const OUTBOUND_QUEUE = 'communication-channels-outbound'
const EVENTS_QUEUE = 'events'

const PLAIN_COLUMNS = [
  'id',
  'organization_id',
  'tenant_id',
  'entity_id',
  'interaction_type',
  'external_message_id',
  'channel_provider_key',
  'channel_id',
  'status',
  'scheduled_at',
  'occurred_at',
  'priority',
  'author_user_id',
  'owner_user_id',
  'appearance_icon',
  'appearance_color',
  'source',
  'deal_id',
  'duration_minutes',
  'location',
  'all_day',
  'recurrence_rule',
  'recurrence_end',
  'participants',
  'reminder_minutes',
  'visibility',
  'linked_entities',
  'guest_permissions',
  'pinned',
  'created_at',
  'deleted_at',
] as const

type InteractionRow = Record<(typeof PLAIN_COLUMNS)[number] | 'updated_at', unknown>
type ApiInteraction = { id?: string; title?: string | null; body?: string | null }

async function readRows(entityId: string): Promise<Map<string, InteractionRow>> {
  return withClient(async (client) => {
    const result = await client.query<InteractionRow>(
      `select ${PLAIN_COLUMNS.join(', ')}, updated_at from customer_interactions where entity_id = $1 order by id`,
      [entityId],
    )
    return new Map(result.rows.map((row) => [String(row.id), row]))
  })
}

function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  return value
}

function diffRows(before: Map<string, InteractionRow>, after: Map<string, InteractionRow>): string[] {
  const differences: string[] = []
  for (const [id, row] of before) {
    const restored = after.get(id)
    if (!restored) {
      differences.push(`${id}: missing after undo`)
      continue
    }
    for (const column of PLAIN_COLUMNS) {
      const expected = JSON.stringify(normalize(row[column]))
      const actual = JSON.stringify(normalize(restored[column]))
      if (expected !== actual) differences.push(`${id}.${column}: ${expected} -> ${actual}`)
    }
    if (new Date(restored.updated_at as Date).getTime() < new Date(row.updated_at as Date).getTime()) {
      differences.push(`${id}.updated_at moved backwards`)
    }
  }
  for (const id of after.keys()) {
    if (!before.has(id)) differences.push(`${id}: unexpected row after undo`)
  }
  return differences
}

async function listInteractions(
  request: APIRequestContext,
  token: string,
  entityId: string,
): Promise<Map<string, ApiInteraction>> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/customers/interactions?entityId=${encodeURIComponent(entityId)}&pageSize=100`,
    { token },
  )
  expect(response.ok(), `GET /api/customers/interactions should succeed (got ${response.status()})`).toBeTruthy()
  const body = await readJsonSafe<{ items?: ApiInteraction[] }>(response)
  return new Map((body?.items ?? []).filter((item) => typeof item.id === 'string').map((item) => [item.id as string, item]))
}

async function createInteraction(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/customers/interactions', { token, data })
  expect(response.status(), `POST /api/customers/interactions should return 201 (got ${response.status()})`).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(typeof body?.id, 'interaction id returned').toBe('string')
  return body?.id as string
}

async function pinInteraction(request: APIRequestContext, token: string, id: string): Promise<void> {
  const response = await apiRequest(request, 'PUT', '/api/customers/interactions', { token, data: { id, pinned: true } })
  expect(response.ok(), `PUT pinned should succeed (got ${response.status()})`).toBeTruthy()
}

function meetingPayload(entityId: string, linkedId: string, stamp: number): Record<string, unknown> {
  return {
    entityId,
    interactionType: 'meeting',
    title: `Undo meeting ${stamp}`,
    body: `Agenda ${stamp}`,
    status: 'planned',
    scheduledAt: '2026-11-03T09:00:00.000Z',
    priority: 3,
    appearanceIcon: 'calendar',
    appearanceColor: '#2563eb',
    durationMinutes: 45,
    location: 'Room 4B',
    allDay: false,
    recurrenceRule: 'FREQ=WEEKLY;COUNT=4',
    recurrenceEnd: '2026-11-24T09:45:00.000Z',
    participants: [{ name: 'Guest One', email: 'guest-one@example.com', status: 'accepted' }],
    reminderMinutes: 15,
    visibility: 'team',
    linkedEntities: [{ id: linkedId, type: 'company', label: 'Linked record' }],
    guestPermissions: { canInviteOthers: false, canModify: true, canSeeList: true },
  }
}

async function composeEmail(
  request: APIRequestContext,
  args: { authorToken: string; channelId: string; personId: string; subject: string; visibility: 'private' | 'shared' },
): Promise<string> {
  const composeResp = await apiRequest(request, 'POST', `/api/customers/people/${args.personId}/emails`, {
    token: args.authorToken,
    data: {
      userChannelId: args.channelId,
      to: ['undo-target@example.com'],
      subject: args.subject,
      body: `Body for ${args.subject}`,
      bodyFormat: 'text',
      visibility: args.visibility,
    },
  })
  expect(composeResp.ok(), `compose (${args.visibility}) should succeed (got ${composeResp.status()})`).toBeTruthy()
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    await drainIntegrationQueue(OUTBOUND_QUEUE, { appRoot: APP_ROOT })
    await drainIntegrationQueue(EVENTS_QUEUE, { appRoot: APP_ROOT })
    const rows = await withClient(async (client) => {
      const result = await client.query<{ id: string; visibility: string | null; external_message_id: string | null; channel_id: string | null }>(
        `select id, visibility, external_message_id, channel_id from customer_interactions
          where entity_id = $1 and interaction_type = 'email' and channel_id = $2 and visibility = $3 and deleted_at is null`,
        [args.personId, args.channelId, args.visibility],
      )
      return result.rows
    })
    const match = rows.find((row) => row.external_message_id)
    if (match) return match.id
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out resolving the ${args.visibility} email interaction for "${args.subject}"`)
}

async function deleteRecord(
  request: APIRequestContext,
  token: string,
  collection: 'people' | 'companies',
  id: string,
) {
  const response = await apiRequest(request, 'DELETE', `/api/customers/${collection}?id=${encodeURIComponent(id)}`, { token })
  expect(response.ok(), `DELETE ${collection} should succeed (got ${response.status()})`).toBeTruthy()
  return expectOperation(response, `customers.${collection}.delete`)
}

async function expectNoRows(entityId: string, context: string): Promise<void> {
  const rows = await readRows(entityId)
  expect(rows.size, `${context}: interactions removed by the delete`).toBe(0)
}

test.describe('TC-CRM-EMAIL-UNDO-001: delete → undo restores interactions exactly', () => {
  test('person delete → undo → redo → undo keeps email linkage, visibility and meeting metadata', async ({ request }) => {
    test.slow()
    const stamp = Date.now()
    let adminToken: string | null = null
    let roleId: string | null = null
    let userAId: string | null = null
    let userBId: string | null = null
    let personId: string | null = null
    let companyId: string | null = null
    let channelId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const scope = getTokenScope(adminToken)
      test.skip(
        !(await isChannelSeedingAvailable(request, adminToken)),
        'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled in this environment; cannot seed email threads.',
      )

      const roleName = `qa_crm_email_undo_${stamp}`
      roleId = await createRoleFixture(request, adminToken, { name: roleName, tenantId: scope.tenantId })
      const aclResp = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
        token: adminToken,
        data: {
          roleId,
          features: [
            'customers.people.view',
            'customers.interactions.view',
            'customers.email.compose',
            'communication_channels.connect_user_channel',
          ],
        },
      })
      expect(aclResp.ok(), 'PUT role ACL should succeed').toBeTruthy()

      const password = 'Valid1!Pass'
      const userAEmail = `qa-crm-email-undo-a-${stamp}@acme.com`
      userAId = await createUserFixture(request, adminToken, {
        email: userAEmail,
        password,
        organizationId: scope.organizationId,
        roles: [roleName],
        name: 'QA Email Undo Author',
      })
      const userAToken = await getAuthToken(request, userAEmail, password)
      const userBEmail = `qa-crm-email-undo-b-${stamp}@acme.com`
      userBId = await createUserFixture(request, adminToken, {
        email: userBEmail,
        password,
        organizationId: scope.organizationId,
        roles: [roleName],
        name: 'QA Email Undo Teammate',
      })
      const userBToken = await getAuthToken(request, userBEmail, password)

      companyId = await createCompanyFixture(request, adminToken, `QA Email Undo Co ${stamp}`)
      personId = await createPersonFixture(request, adminToken, {
        firstName: 'EmailUndo',
        lastName: `Person${stamp}`,
        displayName: `EmailUndo Person ${stamp}`,
      })
      channelId = await seedConnectedChannel(request, userAToken, {
        displayName: `TC-CRM-EMAIL-UNDO ${stamp}`,
        externalIdentifier: `tc-crm-email-undo-${stamp}@test-seed.local`,
      })

      const privateEmailId = await composeEmail(request, {
        authorToken: userAToken,
        channelId,
        personId,
        subject: `Undo private ${stamp}`,
        visibility: 'private',
      })
      const sharedEmailId = await composeEmail(request, {
        authorToken: userAToken,
        channelId,
        personId,
        subject: `Undo shared ${stamp}`,
        visibility: 'shared',
      })
      const meetingId = await createInteraction(request, adminToken, meetingPayload(personId, companyId, stamp))
      await pinInteraction(request, adminToken, meetingId)
      const noteId = await createInteraction(request, adminToken, {
        entityId: personId,
        interactionType: 'note',
        title: `Plain note ${stamp}`,
      })

      const rowsBefore = await readRows(personId)
      expect(rowsBefore.size, 'four interactions seeded').toBe(4)
      expect(rowsBefore.get(privateEmailId)?.visibility).toBe('private')
      expect(rowsBefore.get(privateEmailId)?.external_message_id, 'private email linked to its message').toBeTruthy()
      expect(rowsBefore.get(meetingId)?.pinned).toBe(true)
      const apiBefore = await listInteractions(request, userAToken, personId)
      const teammateBefore = await listInteractions(request, userBToken, personId)
      expect(teammateBefore.has(privateEmailId), 'teammate cannot read the private email before delete').toBe(false)
      expect(teammateBefore.has(sharedEmailId), 'teammate reads the shared email before delete').toBe(true)

      const deleteOp = await deleteRecord(request, adminToken, 'people', personId)
      await expectNoRows(personId, 'person delete')

      await undoOk(request, adminToken, deleteOp.undoToken, 'person delete')
      const rowsAfterUndo = await readRows(personId)
      expect(diffRows(rowsBefore, rowsAfterUndo), 'person delete → undo restores every interaction column').toEqual([])
      const apiAfterUndo = await listInteractions(request, userAToken, personId)
      for (const id of [privateEmailId, sharedEmailId, meetingId, noteId]) {
        expect(apiAfterUndo.get(id)?.title, `${id} title restored`).toBe(apiBefore.get(id)?.title)
        expect(apiAfterUndo.get(id)?.body, `${id} body restored`).toBe(apiBefore.get(id)?.body)
      }
      const teammateAfterUndo = await listInteractions(request, userBToken, personId)
      expect(teammateAfterUndo.has(privateEmailId), 'teammate still cannot read the private email after undo').toBe(false)
      expect(teammateAfterUndo.has(sharedEmailId), 'teammate still reads the shared email after undo').toBe(true)
      expect(apiAfterUndo.has(privateEmailId), 'author reads the private email after undo').toBe(true)

      const redoOp = await redoOk(request, adminToken, deleteOp.logId, 'person delete redo')
      await expectNoRows(personId, 'person delete redo')
      expect(redoOp.undoToken, 'redo of the delete is undoable').toBeTruthy()
      await undoOk(request, adminToken, redoOp.undoToken as string, 'person delete redo')
      const rowsAfterSecondUndo = await readRows(personId)
      expect(diffRows(rowsBefore, rowsAfterSecondUndo), 'redo → undo restores every interaction column again').toEqual([])
      const teammateAfterSecondUndo = await listInteractions(request, userBToken, personId)
      expect(teammateAfterSecondUndo.has(privateEmailId), 'teammate cannot read the private email after redo → undo').toBe(false)
    } finally {
      if (adminToken) {
        await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId)
        await deleteEntityIfExists(request, adminToken, '/api/customers/companies', companyId)
        if (channelId) await deleteChannelIfExists(request, adminToken, channelId)
        await deleteUserIfExists(request, adminToken, userAId)
        await deleteUserIfExists(request, adminToken, userBId)
        await deleteRoleIfExists(request, adminToken, roleId)
      }
    }
  })

  test('company delete → undo restores email linkage, visibility and meeting metadata', async ({ request }) => {
    const stamp = Date.now()
    let adminToken: string | null = null
    let roleId: string | null = null
    let userAId: string | null = null
    let userBId: string | null = null
    let companyId: string | null = null
    let linkedCompanyId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const scope = getTokenScope(adminToken)
      const roleName = `qa_crm_email_undo_co_${stamp}`
      roleId = await createRoleFixture(request, adminToken, { name: roleName, tenantId: scope.tenantId })
      const aclResp = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
        token: adminToken,
        data: { roleId, features: ['customers.companies.view', 'customers.interactions.view'] },
      })
      expect(aclResp.ok(), 'PUT role ACL should succeed').toBeTruthy()
      const password = 'Valid1!Pass'
      const userAEmail = `qa-crm-email-undo-co-a-${stamp}@acme.com`
      userAId = await createUserFixture(request, adminToken, {
        email: userAEmail,
        password,
        organizationId: scope.organizationId,
        roles: [roleName],
        name: 'QA Company Undo Author',
      })
      const userAToken = await getAuthToken(request, userAEmail, password)
      const userBEmail = `qa-crm-email-undo-co-b-${stamp}@acme.com`
      userBId = await createUserFixture(request, adminToken, {
        email: userBEmail,
        password,
        organizationId: scope.organizationId,
        roles: [roleName],
        name: 'QA Company Undo Teammate',
      })
      const userBToken = await getAuthToken(request, userBEmail, password)

      companyId = await createCompanyFixture(request, adminToken, `QA Undo Company ${stamp}`)
      linkedCompanyId = await createCompanyFixture(request, adminToken, `QA Undo Linked ${stamp}`)
      const meetingId = await createInteraction(request, adminToken, meetingPayload(companyId, linkedCompanyId, stamp))
      await pinInteraction(request, adminToken, meetingId)
      const emailId = await createInteraction(request, adminToken, {
        entityId: companyId,
        interactionType: 'email',
        title: `Company private email ${stamp}`,
        body: `Company private body ${stamp}`,
        status: 'done',
        occurredAt: '2026-10-01T08:00:00.000Z',
      })
      await withClient(async (client) => {
        await client.query(
          `update customer_interactions
              set author_user_id = $2, visibility = 'private', channel_provider_key = 'gmail',
                  channel_id = gen_random_uuid(), external_message_id = gen_random_uuid()
            where id = $1`,
          [emailId, userAId],
        )
      })

      const rowsBefore = await readRows(companyId)
      expect(rowsBefore.size, 'two interactions seeded').toBe(2)
      const apiBefore = await listInteractions(request, userAToken, companyId)
      expect(apiBefore.has(emailId), 'author reads the private company email before delete').toBe(true)
      expect((await listInteractions(request, userBToken, companyId)).has(emailId), 'teammate cannot read it before delete').toBe(false)

      const deleteOp = await deleteRecord(request, adminToken, 'companies', companyId)
      await expectNoRows(companyId, 'company delete')
      await undoOk(request, adminToken, deleteOp.undoToken, 'company delete')

      const rowsAfterUndo = await readRows(companyId)
      expect(diffRows(rowsBefore, rowsAfterUndo), 'company delete → undo restores every interaction column').toEqual([])
      const apiAfterUndo = await listInteractions(request, userAToken, companyId)
      for (const id of [emailId, meetingId]) {
        expect(apiAfterUndo.get(id)?.title, `${id} title restored`).toBe(apiBefore.get(id)?.title)
        expect(apiAfterUndo.get(id)?.body, `${id} body restored`).toBe(apiBefore.get(id)?.body)
      }
      expect((await listInteractions(request, userBToken, companyId)).has(emailId), 'teammate still cannot read it after undo').toBe(false)
    } finally {
      if (adminToken) {
        await deleteEntityIfExists(request, adminToken, '/api/customers/companies', companyId)
        await deleteEntityIfExists(request, adminToken, '/api/customers/companies', linkedCompanyId)
        await deleteUserIfExists(request, adminToken, userAId)
        await deleteUserIfExists(request, adminToken, userBId)
        await deleteRoleIfExists(request, adminToken, roleId)
      }
    }
  })
})
