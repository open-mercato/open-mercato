import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  deleteChannelIfExists,
  ingestInboundChatMessage,
  isChannelSeedingAvailable,
  seedConnectedChannel,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'

/**
 * TC-CHANNEL-INBOX-001 — an inbound message on an unassigned channel conversation
 * shows up in the Inbox of every operator who may work the channel, and nowhere else.
 * Source: https://github.com/open-mercato/open-mercato/issues/6106
 *
 * An inbound channel message has the channel system user as sender and, on an
 * unassigned conversation (a shared channel has no default assignee), no
 * `message_recipients` row — so the recipient-only inbox never listed it. The list
 * now widens to exactly that case: inbound, unassigned, channel the caller may work,
 * caller holds `messages.view`, caller has no recipient row of their own.
 *
 * Positive:
 *   - an operator with `messages.view` sees the message in `inbox` and in `all`,
 *     flagged `unread`, and counted by `unread-count`;
 *   - read / unread / archive / delete work on it (the caller's own recipient row is
 *     created on first action), and a message the operator deleted does not come
 *     back in `all`.
 *
 * Denials — each of them listed before the fix's predicate was narrowed:
 *   - an operator without `messages.view` sees nothing;
 *   - a personal mailbox of another user (its conversation is assigned to the owner);
 *   - an internal note posted on the channel thread;
 *   - the operator's own reply to the conversation;
 *   - a conversation assigned to a colleague.
 *
 * Driven via the env-gated test-seed fixture (`OM_ENABLE_TEST_CHANNEL_SEEDING`) and
 * the REAL `ingest_inbound_message` command; skips when the gate is off.
 */
const PASSWORD = 'Valid1!Pass'

type ListItem = { id: string; status?: string }

function readTokenUserId(token: string): string {
  const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { sub?: unknown }
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new Error('[internal] auth token carries no subject')
  }
  return payload.sub
}

async function listFolder(
  request: APIRequestContext,
  token: string,
  folder: 'inbox' | 'all' | 'archived',
): Promise<Map<string, string | undefined>> {
  const response = await apiRequest(request, 'GET', `/api/messages?folder=${folder}&pageSize=100`, { token })
  expect(response.status(), `GET /api/messages?folder=${folder} should return 200`).toBe(200)
  const body = await readJsonSafe<{ items?: ListItem[] }>(response)
  return new Map((body?.items ?? []).map((item) => [item.id, item.status]))
}

async function unreadCount(request: APIRequestContext, token: string): Promise<number> {
  const response = await apiRequest(request, 'GET', '/api/messages/unread-count', { token })
  expect(response.status(), 'GET /api/messages/unread-count should return 200').toBe(200)
  const body = await readJsonSafe<{ unreadCount?: number }>(response)
  return body?.unreadCount ?? 0
}

test.describe('TC-CHANNEL-INBOX-001: unassigned channel conversations in the Inbox', () => {
  test('lists, flags and works inbound unassigned messages for operators with messages.view only', async ({
    request,
  }) => {
    test.slow()
    let adminToken: string | null = null
    let sharedChannelId: string | null = null
    let personalChannelId: string | null = null
    let operatorRoleId: string | null = null
    let outsiderRoleId: string | null = null
    let operatorUserId: string | null = null
    let outsiderUserId: string | null = null
    try {
      adminToken = await getAuthToken(request, 'admin')
      const seedingAvailable = await isChannelSeedingAvailable(request, adminToken)
      test.skip(
        !seedingAvailable,
        'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled in this environment; cannot connect a channel.',
      )

      const stamp = Date.now()
      const { organizationId, tenantId } = getTokenContext(adminToken)
      const adminUserId = readTokenUserId(adminToken)

      // The operator may read and answer messages; the outsider holds a messages
      // feature that is NOT `messages.view`, so the only thing separating the two
      // is that gate.
      operatorRoleId = await createRoleFixture(request, adminToken, {
        name: `qa-tc-channel-inbox-001-operator-${stamp}`,
        tenantId,
      })
      await setRoleAclFeatures(request, adminToken, {
        roleId: operatorRoleId,
        features: ['messages.view', 'messages.compose'],
        organizations: [organizationId],
      })
      outsiderRoleId = await createRoleFixture(request, adminToken, {
        name: `qa-tc-channel-inbox-001-outsider-${stamp}`,
        tenantId,
      })
      await setRoleAclFeatures(request, adminToken, {
        roleId: outsiderRoleId,
        features: ['messages.compose'],
        organizations: [organizationId],
      })
      const operatorEmail = `qa-tc-channel-inbox-001-op-${stamp}@test.invalid`
      const outsiderEmail = `qa-tc-channel-inbox-001-out-${stamp}@test.invalid`
      operatorUserId = await createUserFixture(request, adminToken, {
        email: operatorEmail,
        password: PASSWORD,
        organizationId,
        roles: [operatorRoleId],
        name: 'QA TC-CHANNEL-INBOX-001 Operator',
      })
      outsiderUserId = await createUserFixture(request, adminToken, {
        email: outsiderEmail,
        password: PASSWORD,
        organizationId,
        roles: [outsiderRoleId],
        name: 'QA TC-CHANNEL-INBOX-001 Outsider',
      })
      const operatorToken = await getAuthToken(request, operatorEmail, PASSWORD)
      const outsiderToken = await getAuthToken(request, outsiderEmail, PASSWORD)

      // A shared channel has no default assignee: its inbound messages are unassigned.
      sharedChannelId = await seedConnectedChannel(request, adminToken, {
        displayName: `TC-CHANNEL-INBOX-001 shared ${stamp}`,
        providerFlavor: 'chat',
        shared: true,
      })
      // A personal mailbox owned by the admin: every inbound message is assigned to
      // the owner, so no other operator may see it.
      personalChannelId = await seedConnectedChannel(request, adminToken, {
        displayName: `TC-CHANNEL-INBOX-001 personal ${stamp}`,
        providerFlavor: 'chat',
      })

      const unassigned = await ingestInboundChatMessage(request, adminToken, {
        channelId: sharedChannelId,
        senderIdentifier: `chat-user-${stamp}`,
        senderDisplayName: 'Karol Kapsa',
        body: 'is anyone there?',
        externalMessageId: `shared-message-${stamp}`,
        externalConversationId: `shared-conversation-${stamp}`,
      })
      expect(unassigned.status, 'the hub must accept the inbound message').toBe('created')
      const unassignedId = unassigned.messageId as string
      expect(unassignedId, 'a platform message must have been composed').toBeTruthy()

      const personal = await ingestInboundChatMessage(request, adminToken, {
        channelId: personalChannelId,
        senderIdentifier: `chat-user-personal-${stamp}`,
        senderDisplayName: 'Private Person',
        body: 'this is for the mailbox owner',
        externalMessageId: `personal-message-${stamp}`,
        externalConversationId: `personal-conversation-${stamp}`,
      })
      expect(personal.status, 'the hub must accept the inbound message').toBe('created')
      const personalId = personal.messageId as string

      // (1) The operator sees the unassigned message in Inbox and All, flagged new.
      const operatorInbox = await listFolder(request, operatorToken, 'inbox')
      expect(
        operatorInbox.has(unassignedId),
        'an operator with messages.view must see the unassigned channel message in the Inbox',
      ).toBe(true)
      expect(operatorInbox.get(unassignedId), 'a new customer message must be flagged as new').toBe('unread')
      expect(
        (await listFolder(request, operatorToken, 'all')).has(unassignedId),
        'the All folder must list the unassigned channel message too',
      ).toBe(true)
      const unreadBefore = await unreadCount(request, operatorToken)
      expect(unreadBefore, 'unread-count must count the unassigned channel message').toBeGreaterThanOrEqual(1)

      // (2) Nothing else leaks into the operator's lists.
      expect(
        operatorInbox.has(personalId),
        "another user's personal mailbox must stay out of the Inbox",
      ).toBe(false)
      expect(
        (await listFolder(request, operatorToken, 'all')).has(personalId),
        "another user's personal mailbox must stay out of All",
      ).toBe(false)

      // (3) Without messages.view nothing is widened, whatever the channel allows.
      const outsiderInbox = await listFolder(request, outsiderToken, 'inbox')
      const outsiderAll = await listFolder(request, outsiderToken, 'all')
      for (const [folder, list] of [['Inbox', outsiderInbox], ['All', outsiderAll]] as const) {
        expect(list.has(unassignedId), `a caller without messages.view must not see it in ${folder}`).toBe(false)
        expect(list.has(personalId), `a caller without messages.view must not see it in ${folder}`).toBe(false)
      }

      // (4) An internal note on the channel thread is not listed to the operator.
      const noteResponse = await apiRequest(request, 'POST', '/api/messages', {
        token: adminToken,
        data: {
          visibility: 'internal',
          parentMessageId: unassignedId,
          recipients: [{ userId: outsiderUserId, type: 'to' }],
          subject: `Internal note ${stamp}`,
          body: 'Internal: they are fishing for a refund.',
          sendViaEmail: false,
        },
      })
      expect(noteResponse.status(), 'the internal note must be composed').toBe(201)
      const noteId = (await readJsonSafe<{ id?: string }>(noteResponse))?.id as string
      expect(noteId, 'the internal note must have been persisted').toBeTruthy()
      expect(
        (await listFolder(request, operatorToken, 'inbox')).has(noteId),
        'an internal note on the channel thread must not be listed in the Inbox',
      ).toBe(false)
      expect(
        (await listFolder(request, operatorToken, 'all')).has(noteId),
        'an internal note on the channel thread must not be listed in All',
      ).toBe(false)

      // (5) The operator's own reply is not an inbound message: it stays out of
      // their Inbox, while the customer message it answers is still there.
      const replyResponse = await apiRequest(request, 'POST', `/api/messages/${unassignedId}/reply`, {
        token: operatorToken,
        data: { body: 'yes, we are here', bodyFormat: 'text' },
      })
      expect(replyResponse.status(), 'the operator must be able to answer the message').toBe(201)
      const replyId = (await readJsonSafe<{ id?: string }>(replyResponse))?.id as string
      expect(replyId, 'the reply must have been persisted').toBeTruthy()
      const inboxAfterReply = await listFolder(request, operatorToken, 'inbox')
      expect(inboxAfterReply.has(replyId), "the operator's own reply must not appear in their Inbox").toBe(false)
      expect(inboxAfterReply.has(unassignedId), 'the customer message must still be listed').toBe(true)

      // (6) A conversation assigned to a colleague leaves the operator's Inbox.
      const assigned = await ingestInboundChatMessage(request, adminToken, {
        channelId: sharedChannelId,
        senderIdentifier: `chat-user-assigned-${stamp}`,
        senderDisplayName: 'Assigned Person',
        body: 'please route me to the admin',
        externalMessageId: `assigned-message-${stamp}`,
        externalConversationId: `assigned-conversation-${stamp}`,
      })
      const assignedId = assigned.messageId as string
      expect((await listFolder(request, operatorToken, 'inbox')).has(assignedId)).toBe(true)
      const assignResponse = await apiRequest(
        request,
        'PUT',
        `/api/communication_channels/threads/${assignedId}/assign`,
        { token: adminToken, data: { assignedUserId: adminUserId } },
      )
      expect(assignResponse.ok(), 'assigning the conversation to a colleague must succeed').toBe(true)
      expect(
        (await listFolder(request, operatorToken, 'inbox')).has(assignedId),
        'a conversation assigned to a colleague must leave the operator Inbox',
      ).toBe(false)

      // (7) The operator can act on the widened row. Each action creates their own
      // recipient row on first use; before the fix every one of them answered 403.
      const markRead = await apiRequest(request, 'PUT', `/api/messages/${unassignedId}/read`, { token: operatorToken })
      expect(markRead.status(), 'mark read must work on an unassigned channel message').toBe(200)
      expect((await listFolder(request, operatorToken, 'inbox')).get(unassignedId)).toBe('read')

      const markUnread = await apiRequest(request, 'DELETE', `/api/messages/${unassignedId}/read`, { token: operatorToken })
      expect(markUnread.status(), 'mark unread must work on an unassigned channel message').toBe(200)
      expect((await listFolder(request, operatorToken, 'inbox')).get(unassignedId)).toBe('unread')

      const archive = await apiRequest(request, 'PUT', `/api/messages/${unassignedId}/archive`, { token: operatorToken })
      expect(archive.status(), 'archive must work on an unassigned channel message').toBe(200)
      expect(
        (await listFolder(request, operatorToken, 'inbox')).has(unassignedId),
        'an archived message must leave the Inbox and not come back through the widening',
      ).toBe(false)
      expect((await listFolder(request, operatorToken, 'archived')).has(unassignedId)).toBe(true)

      const deleted = await apiRequest(request, 'DELETE', `/api/messages/${unassignedId}`, { token: operatorToken })
      expect(deleted.status(), 'delete must work on an unassigned channel message').toBe(200)
      expect((await listFolder(request, operatorToken, 'inbox')).has(unassignedId)).toBe(false)
      expect(
        (await listFolder(request, operatorToken, 'all')).has(unassignedId),
        'a message the operator deleted must not reappear in All',
      ).toBe(false)

      // Another operator is unaffected by this operator's state: the admin never
      // touched the message, so it is still new for them.
      expect(
        (await listFolder(request, adminToken, 'inbox')).get(unassignedId),
        "one operator's actions must not change another operator's view",
      ).toBe('unread')
    } finally {
      await deleteChannelIfExists(request, adminToken, sharedChannelId)
      await deleteChannelIfExists(request, adminToken, personalChannelId)
      await deleteUserIfExists(request, adminToken, operatorUserId)
      await deleteUserIfExists(request, adminToken, outsiderUserId)
      await deleteRoleIfExists(request, adminToken, operatorRoleId)
      await deleteRoleIfExists(request, adminToken, outsiderRoleId)
    }
  })
})
