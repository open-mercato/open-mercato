import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { config as loadEnv } from 'dotenv'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'
import {
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'
import {
  deleteChannelIfExists,
  isChannelSeedingAvailable,
  seedConnectedChannel,
} from '@open-mercato/core/modules/core/__integration__/helpers/communicationChannelsFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'

/**
 * TC-CRM-EMAIL-008: a CRM reply may only name a parent the caller can read on
 * that Person's email history.
 *
 * `POST /api/customers/people/[id]/emails` forwards `parentMessageId` to the
 * send-as-user facade, which threads the new message onto the parent. The
 * parent must be readable through the same rule `GET /email-threads` applies:
 * the caller's own mail, shared mail, a conversation share for this Person, or a
 * shared team mailbox. Without one of those, User B cannot see User A's private
 * email — and so must not be able to reply onto it. Granting access lets the
 * reply through; revoking it refuses a reply from a stale tab.
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

type ThreadMessage = { id?: string; messageId?: string | null }

async function fetchThreadMessages(
  request: APIRequestContext,
  token: string,
  personId: string,
): Promise<ThreadMessage[]> {
  const resp = await apiRequest(
    request,
    'GET',
    `/api/customers/people/${encodeURIComponent(personId)}/email-threads`,
    { token },
  )
  expect(resp.ok(), `GET /email-threads should succeed (got ${resp.status()})`).toBeTruthy()
  const body = await readJsonSafe<{ threads?: Array<{ messages?: ThreadMessage[] }> }>(resp)
  return (body?.threads ?? []).flatMap((thread) => thread.messages ?? [])
}

async function drainUntil(check: () => Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    await drainIntegrationQueue(OUTBOUND_QUEUE, { appRoot: APP_ROOT })
    await drainIntegrationQueue(EVENTS_QUEUE, { appRoot: APP_ROOT })
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function setConversationShared(
  request: APIRequestContext,
  token: string,
  personId: string,
  shared: boolean,
): Promise<number> {
  const resp = await apiRequest(
    request,
    'PUT',
    `/api/customers/people/${encodeURIComponent(personId)}/email-share`,
    { token, data: { shared } },
  )
  return resp.status()
}

async function setChannelVisibility(
  request: APIRequestContext,
  token: string,
  channelId: string,
  visibility: 'private' | 'shared',
): Promise<number> {
  const resp = await apiRequest(
    request,
    'PUT',
    `/api/communication_channels/channels/${encodeURIComponent(channelId)}/visibility`,
    { token, data: { visibility } },
  )
  return resp.status()
}

async function composeOnPerson(
  request: APIRequestContext,
  args: { token: string; channelId: string; personId: string; subject: string; parentMessageId?: string },
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const resp = await apiRequest(request, 'POST', `/api/customers/people/${args.personId}/emails`, {
    token: args.token,
    data: {
      userChannelId: args.channelId,
      to: ['parent-guard@example.com'],
      subject: args.subject,
      body: `Body for ${args.subject}`,
      bodyFormat: 'text',
      visibility: 'private',
      ...(args.parentMessageId ? { parentMessageId: args.parentMessageId } : {}),
    },
  })
  return { status: resp.status(), body: await readJsonSafe<Record<string, unknown>>(resp) }
}

type WriteFootprint = {
  messages: number
  channelLinks: number
  conversations: number
  threadMappings: number
  interactions: number
}

async function readWriteFootprint(userId: string, channelId: string): Promise<WriteFootprint> {
  return withClient(async (client) => {
    const count = async (sql: string, params: unknown[]) =>
      Number((await client.query<{ count: string }>(sql, params)).rows[0].count)
    return {
      messages: await count('select count(*)::text as count from messages where sender_user_id = $1', [userId]),
      channelLinks: await count(
        `select count(*)::text as count from message_channel_links l
           join messages m on m.id = l.message_id
          where m.sender_user_id = $1`,
        [userId],
      ),
      conversations: await count(
        'select count(*)::text as count from external_conversations where channel_id = $1',
        [channelId],
      ),
      threadMappings: await count(
        'select count(*)::text as count from channel_thread_mappings where channel_id = $1',
        [channelId],
      ),
      interactions: await count(
        `select count(*)::text as count from customer_interactions i
           join message_channel_links l on l.id = i.external_message_id
           join messages m on m.id = l.message_id
          where m.sender_user_id = $1 and i.interaction_type = 'email'`,
        [userId],
      ),
    }
  })
}

async function readThreadId(messageId: string): Promise<string | null> {
  return withClient(async (client) => {
    const result = await client.query<{ thread_id: string | null }>(
      'select thread_id from messages where id = $1',
      [messageId],
    )
    return result.rows[0]?.thread_id ?? null
  })
}

test.describe('TC-CRM-EMAIL-008: CRM reply parent must be readable on the Person', () => {
  test(
    'an unreadable parent is refused without writes; a share or shared mailbox lets the reply through; revoking refuses it again',
    async ({ request }) => {
      test.slow()

      const stamp = Date.now()
      let adminToken: string | null = null
      let userAToken: string | null = null
      let userBToken: string | null = null
      let userAId: string | null = null
      let userBId: string | null = null
      let roleId: string | null = null
      let personId: string | null = null
      let channelAId: string | null = null
      let channelBId: string | null = null

      try {
        adminToken = await getAuthToken(request, 'admin')
        const scope = getTokenScope(adminToken)

        const seedingAvailable = await isChannelSeedingAvailable(request, adminToken)
        test.skip(
          !seedingAvailable,
          'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled in this environment; cannot seed email threads.',
        )

        const roleName = `qa_crm_email_parent_${stamp}`
        roleId = await createRoleFixture(request, adminToken, { name: roleName, tenantId: scope.tenantId })
        const aclResp = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
          token: adminToken,
          data: {
            roleId,
            features: [
              'customers.people.view',
              'customers.interactions.view',
              'customers.email.compose',
              'customers.email.share_conversation',
              'communication_channels.connect_user_channel',
              'communication_channels.share_own_channel',
            ],
          },
        })
        expect(aclResp.ok(), 'PUT role ACL should succeed').toBeTruthy()

        const password = 'Valid1!Pass'
        const userAEmail = `qa-crm-email-parent-a-${stamp}@acme.com`
        userAId = await createUserFixture(request, adminToken, {
          email: userAEmail,
          password,
          organizationId: scope.organizationId,
          roles: [roleName],
          name: 'QA CRM Parent User A',
        })
        userAToken = await getAuthToken(request, userAEmail, password)

        const userBEmail = `qa-crm-email-parent-b-${stamp}@acme.com`
        userBId = await createUserFixture(request, adminToken, {
          email: userBEmail,
          password,
          organizationId: scope.organizationId,
          roles: [roleName],
          name: 'QA CRM Parent User B',
        })
        userBToken = await getAuthToken(request, userBEmail, password)

        personId = await createPersonFixture(request, adminToken, {
          firstName: 'EmailParent',
          lastName: `Person${stamp}`,
          displayName: `EmailParent Person ${stamp}`,
        })

        channelAId = await seedConnectedChannel(request, userAToken, {
          displayName: `TC-CRM-EMAIL-008 A ${stamp}`,
          externalIdentifier: `tc-crm-email-008-a-${stamp}@test-seed.local`,
        })
        channelBId = await seedConnectedChannel(request, userBToken, {
          displayName: `TC-CRM-EMAIL-008 B ${stamp}`,
          externalIdentifier: `tc-crm-email-008-b-${stamp}@test-seed.local`,
        })

        const privateSubject = `TC-CRM-EMAIL-008 private ${stamp}`
        const sent = await composeOnPerson(request, {
          token: userAToken,
          channelId: channelAId,
          personId,
          subject: privateSubject,
        })
        expect(sent.status, "User A's private email should be accepted").toBe(200)
        const parentMessageId = sent.body?.messageId as string
        expect(typeof parentMessageId).toBe('string')
        const ownerToken = userAToken
        const ownerPersonId = personId
        await drainUntil(
          async () =>
            (await fetchThreadMessages(request, ownerToken, ownerPersonId)).some(
              (message) => message.messageId === parentMessageId,
            ),
          "User A's private email on the Person",
        )
        const parentThreadId = (await readThreadId(parentMessageId)) ?? parentMessageId

        const bView = await fetchThreadMessages(request, userBToken, personId)
        expect(
          bView.some((message) => message.messageId === parentMessageId),
          "User B cannot see User A's private email",
        ).toBe(false)

        const footprintBefore = await readWriteFootprint(userBId, channelBId)
        const hijack = await composeOnPerson(request, {
          token: userBToken,
          channelId: channelBId,
          personId,
          subject: `TC-CRM-EMAIL-008 hijack ${stamp}`,
          parentMessageId,
        })
        expect(hijack.status, "replying onto User A's unreadable email is refused").toBe(404)
        await drainIntegrationQueue(OUTBOUND_QUEUE, { appRoot: APP_ROOT })
        await drainIntegrationQueue(EVENTS_QUEUE, { appRoot: APP_ROOT })
        expect(
          await readWriteFootprint(userBId, channelBId),
          'the refused reply wrote no message, link, conversation, mapping or interaction',
        ).toEqual(footprintBefore)

        const unknown = await composeOnPerson(request, {
          token: userBToken,
          channelId: channelBId,
          personId,
          subject: `TC-CRM-EMAIL-008 unknown ${stamp}`,
          parentMessageId: randomUUID(),
        })
        expect(unknown.status, 'an unknown parent id is refused').toBe(404)
        expect(hijack.body, 'the refusal is indistinguishable from an unknown id').toEqual(unknown.body)
        expect(await readWriteFootprint(userBId, channelBId)).toEqual(footprintBefore)

        expect(await setConversationShared(request, userAToken, personId, true), 'User A shares').toBe(200)
        const viaShare = await composeOnPerson(request, {
          token: userBToken,
          channelId: channelBId,
          personId,
          subject: `TC-CRM-EMAIL-008 via share ${stamp}`,
          parentMessageId,
        })
        expect(viaShare.status, 'a conversation share lets User B reply').toBe(200)
        expect(viaShare.body?.threadId, "the reply joins User A's thread").toBe(parentThreadId)
        expect(await readThreadId(viaShare.body?.messageId as string)).toBe(parentThreadId)
        const writerId = userBId
        const writerChannelId = channelBId
        await drainUntil(
          async () => (await readWriteFootprint(writerId, writerChannelId)).interactions > footprintBefore.interactions,
          "User B's accepted reply on the Person",
        )
        const footprintAccepted = await readWriteFootprint(userBId, channelBId)
        for (const key of Object.keys(footprintBefore) as Array<keyof WriteFootprint>) {
          expect(
            footprintAccepted[key],
            `an accepted reply is visible to the ${key} counter, so its unchanged value after a refusal means something`,
          ).toBeGreaterThan(footprintBefore[key])
        }

        expect(await setConversationShared(request, userAToken, personId, false), 'User A un-shares').toBe(200)
        const footprintAfterShare = await readWriteFootprint(userBId, channelBId)
        const staleShare = await composeOnPerson(request, {
          token: userBToken,
          channelId: channelBId,
          personId,
          subject: `TC-CRM-EMAIL-008 stale share ${stamp}`,
          parentMessageId,
        })
        expect(staleShare.status, 'a reply from a stale tab after un-sharing is refused').toBe(404)
        expect(staleShare.body).toEqual(unknown.body)
        expect(await readWriteFootprint(userBId, channelBId)).toEqual(footprintAfterShare)

        expect(
          await setChannelVisibility(request, userAToken, channelAId, 'shared'),
          "User A marks the mailbox shared",
        ).toBe(200)
        const viaChannel = await composeOnPerson(request, {
          token: userBToken,
          channelId: channelBId,
          personId,
          subject: `TC-CRM-EMAIL-008 via shared mailbox ${stamp}`,
          parentMessageId,
        })
        expect(viaChannel.status, 'a shared team mailbox lets User B reply').toBe(200)
        expect(viaChannel.body?.threadId).toBe(parentThreadId)

        expect(await setChannelVisibility(request, userAToken, channelAId, 'private')).toBe(200)
        const footprintAfterChannel = await readWriteFootprint(userBId, channelBId)
        const staleChannel = await composeOnPerson(request, {
          token: userBToken,
          channelId: channelBId,
          personId,
          subject: `TC-CRM-EMAIL-008 stale mailbox ${stamp}`,
          parentMessageId,
        })
        expect(staleChannel.status, 'a reply after the mailbox is made private again is refused').toBe(404)
        expect(await readWriteFootprint(userBId, channelBId)).toEqual(footprintAfterChannel)

        const ownReply = await composeOnPerson(request, {
          token: userAToken,
          channelId: channelAId,
          personId,
          subject: `TC-CRM-EMAIL-008 owner follow-up ${stamp}`,
          parentMessageId,
        })
        expect(ownReply.status, 'the author can always reply onto their own email').toBe(200)
        expect(ownReply.body?.threadId).toBe(parentThreadId)
      } finally {
        if (adminToken) {
          if (userAToken && personId) {
            await setConversationShared(request, userAToken, personId, false).catch(() => 0)
          }
          if (userAToken && channelAId) await deleteChannelIfExists(request, userAToken, channelAId)
          if (userBToken && channelBId) await deleteChannelIfExists(request, userBToken, channelBId)
          await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId)
          await deleteUserIfExists(request, adminToken, userAId)
          await deleteUserIfExists(request, adminToken, userBId)
          await deleteRoleIfExists(request, adminToken, roleId)
        }
      }
    },
  )
})
