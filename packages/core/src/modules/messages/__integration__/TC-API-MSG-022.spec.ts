import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { getTokenScope, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures';
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures';
import { composeMessageWithToken, decodeJwtSubject } from './helpers';

/**
 * TC-API-MSG-022: a compose may only name a parent the caller can read.
 *
 * `POST /api/messages` accepts `parentMessageId` and the compose command derives
 * the new message's thread from it. The parent must be readable by the caller
 * under the same rule as `GET /api/messages/[id]`: sender, live recipient, or an
 * explicitly public message on a channel thread the caller may work.
 *
 * User B holds `messages.view` + `messages.compose` but is neither sender nor
 * recipient of the parent, so it cannot read it — and therefore must not be able
 * to thread a message onto it. An unreadable parent is refused with the same
 * `403 Access denied` the read route answers; a parent that is unknown, deleted
 * or in another organization or tenant answers exactly like an unknown id. No
 * refusal writes anything.
 */

type ComposeBody = Record<string, unknown>;

async function compose(request: APIRequestContext, token: string, data: ComposeBody) {
  const response = await apiRequest(request, 'POST', '/api/messages', { token, data });
  const body = await readJsonSafe<Record<string, unknown>>(response);
  return { status: response.status(), body };
}

async function countMessagesSentBy(userId: string): Promise<{ messages: number; recipients: number }> {
  return withClient(async (client) => {
    const messages = await client.query<{ count: string }>(
      'select count(*)::text as count from messages where sender_user_id = $1',
      [userId],
    );
    const recipients = await client.query<{ count: string }>(
      `select count(*)::text as count from message_recipients r
         join messages m on m.id = r.message_id
        where m.sender_user_id = $1`,
      [userId],
    );
    return { messages: Number(messages.rows[0].count), recipients: Number(recipients.rows[0].count) };
  });
}

async function countThreadMembers(threadId: string): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query<{ count: string }>(
      'select count(*)::text as count from messages where thread_id = $1 or parent_message_id = $1',
      [threadId],
    );
    return Number(result.rows[0].count);
  });
}

async function readThreadLineage(messageId: string): Promise<{ threadId: string | null; parentMessageId: string | null }> {
  return withClient(async (client) => {
    const result = await client.query<{ thread_id: string | null; parent_message_id: string | null }>(
      'select thread_id, parent_message_id from messages where id = $1',
      [messageId],
    );
    return {
      threadId: result.rows[0]?.thread_id ?? null,
      parentMessageId: result.rows[0]?.parent_message_id ?? null,
    };
  });
}

/**
 * Copy `sourceId` into another scope and address the copy to `recipientUserId`,
 * so the caller IS a participant of a message that lives outside its scope.
 */
async function cloneMessageIntoScope(
  sourceId: string,
  scope: { tenantId?: string; organizationId?: string },
  recipientUserId: string,
): Promise<string> {
  const cloneId = randomUUID();
  await withClient(async (client) => {
    const overrides: Record<string, string> = { id: cloneId, thread_id: cloneId };
    if (scope.tenantId) overrides.tenant_id = scope.tenantId;
    if (scope.organizationId) overrides.organization_id = scope.organizationId;
    await client.query(
      `insert into messages
         select (jsonb_populate_record(null::messages, to_jsonb(m) || $2::jsonb)).*
           from messages m where m.id = $1`,
      [sourceId, JSON.stringify(overrides)],
    );
    await client.query(
      `insert into message_recipients (id, message_id, recipient_user_id, recipient_type, status, created_at)
       values ($1, $2, $3, 'to', 'unread', now())`,
      [randomUUID(), cloneId, recipientUserId],
    );
  });
  return cloneId;
}

async function deleteMessagesQuietly(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await withClient(async (client) => {
    await client.query('delete from message_recipients where message_id = any($1::uuid[])', [ids]);
    await client.query('delete from messages where id = any($1::uuid[])', [ids]);
  }).catch(() => undefined);
}

test.describe('TC-API-MSG-022: compose refuses a parent the caller cannot read', () => {
  test('unreadable, foreign, deleted and revoked parents are refused without writes; readable parents still thread', async ({ request }) => {
    const stamp = Date.now();
    const adminToken = await getAuthToken(request, 'admin');
    const employeeToken = await getAuthToken(request, 'employee');
    const adminUserId = decodeJwtSubject(adminToken);
    const employeeUserId = decodeJwtSubject(employeeToken);
    const scope = getTokenScope(adminToken);

    let roleId: string | null = null;
    let outsiderId: string | null = null;
    const rawMessageIds: string[] = [];

    try {
      const roleName = `qa_msg_parent_${stamp}`;
      roleId = await createRoleFixture(request, adminToken, { name: roleName, tenantId: scope.tenantId });
      const aclResponse = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
        token: adminToken,
        data: { roleId, features: ['messages.view', 'messages.compose'] },
      });
      expect(aclResponse.ok(), 'PUT role ACL should succeed').toBeTruthy();

      const outsiderEmail = `qa-msg-parent-${stamp}@acme.com`;
      const outsiderPassword = 'Valid1!Pass';
      outsiderId = await createUserFixture(request, adminToken, {
        email: outsiderEmail,
        password: outsiderPassword,
        organizationId: scope.organizationId,
        roles: [roleName],
        name: 'QA Msg Parent Outsider',
      });
      const outsiderToken = await getAuthToken(request, outsiderEmail, outsiderPassword);

      const parentId = await composeMessageWithToken(request, adminToken, {
        recipients: [{ userId: employeeUserId, type: 'to' }],
        subject: `TC-API-MSG-022 private ${stamp}`,
        body: 'Private conversation between admin and employee',
      });
      const parentLineage = await readThreadLineage(parentId);
      const parentThreadId = parentLineage.threadId ?? parentId;

      const outsiderRead = await apiRequest(request, 'GET', `/api/messages/${parentId}`, { token: outsiderToken });
      expect(outsiderRead.status(), 'the outsider cannot read the parent').toBe(403);

      const threadSizeBefore = await countThreadMembers(parentThreadId);
      const outsiderWritesBefore = await countMessagesSentBy(outsiderId);

      for (const isDraft of [false, true]) {
        const attempt = await compose(request, outsiderToken, {
          recipients: [{ userId: adminUserId, type: 'to' }],
          subject: `TC-API-MSG-022 hijack ${isDraft ? 'draft' : 'sent'} ${stamp}`,
          body: 'Reply onto a conversation the caller cannot read',
          parentMessageId: parentId,
          isDraft,
        });
        expect(attempt.status, `an unreadable parent is refused (isDraft=${isDraft})`).toBe(403);
        expect(attempt.body, 'the refusal matches the read route').toEqual({ error: 'Access denied' });
      }

      expect(await countThreadMembers(parentThreadId), 'nothing joined the parent thread').toBe(threadSizeBefore);
      expect(await countMessagesSentBy(outsiderId), 'the outsider wrote no message and no recipient row').toEqual(
        outsiderWritesBefore,
      );

      const unknown = await compose(request, outsiderToken, {
        recipients: [{ userId: adminUserId, type: 'to' }],
        subject: `TC-API-MSG-022 unknown ${stamp}`,
        body: 'Reply onto an unknown id',
        parentMessageId: randomUUID(),
      });
      expect(unknown.status, 'an unknown parent id is refused').toBe(404);
      expect(await countMessagesSentBy(outsiderId)).toEqual(outsiderWritesBefore);

      const foreignOrgParent = await cloneMessageIntoScope(parentId, { organizationId: randomUUID() }, outsiderId);
      rawMessageIds.push(foreignOrgParent);
      const foreignTenantParent = await cloneMessageIntoScope(parentId, { tenantId: randomUUID() }, outsiderId);
      rawMessageIds.push(foreignTenantParent);
      for (const [label, foreignParent] of [
        ['organization', foreignOrgParent],
        ['tenant', foreignTenantParent],
      ] as const) {
        const attempt = await compose(request, outsiderToken, {
          recipients: [{ userId: adminUserId, type: 'to' }],
          subject: `TC-API-MSG-022 foreign ${label} ${stamp}`,
          body: 'Reply onto a message from another scope',
          parentMessageId: foreignParent,
        });
        expect(attempt.status, `a parent from another ${label} is refused even for its recipient`).toBe(404);
        expect(attempt.body, 'another scope answers exactly like an unknown id').toEqual(unknown.body);
      }
      expect(await countMessagesSentBy(outsiderId)).toEqual(outsiderWritesBefore);

      const addressedToOutsider = await composeMessageWithToken(request, adminToken, {
        recipients: [{ userId: outsiderId, type: 'to' }],
        subject: `TC-API-MSG-022 revocable ${stamp}`,
        body: 'The outsider is a recipient of this one',
      });
      const readable = await compose(request, outsiderToken, {
        recipients: [{ userId: adminUserId, type: 'to' }],
        subject: `TC-API-MSG-022 recipient reply ${stamp}`,
        body: 'A recipient may thread onto its own message',
        parentMessageId: addressedToOutsider,
      });
      expect(readable.status, 'a recipient can still compose onto the parent').toBe(201);
      expect(readable.body?.threadId, 'the reply joins the parent thread').toBe(
        (await readThreadLineage(addressedToOutsider)).threadId ?? addressedToOutsider,
      );

      const outsiderWritesBeforeRevoke = await countMessagesSentBy(outsiderId);
      await withClient(async (client) => {
        await client.query(
          'update message_recipients set deleted_at = now() where message_id = $1 and recipient_user_id = $2',
          [addressedToOutsider, outsiderId],
        );
      });
      const revokedRead = await apiRequest(request, 'GET', `/api/messages/${addressedToOutsider}`, { token: outsiderToken });
      expect(revokedRead.status(), 'once the recipient row is gone the parent is unreadable').toBe(403);
      const stale = await compose(request, outsiderToken, {
        recipients: [{ userId: adminUserId, type: 'to' }],
        subject: `TC-API-MSG-022 stale ${stamp}`,
        body: 'Reply from a stale tab after access was revoked',
        parentMessageId: addressedToOutsider,
      });
      expect(stale.status, 'revoked access is refused').toBe(403);
      expect(stale.body).toEqual({ error: 'Access denied' });
      expect(await countMessagesSentBy(outsiderId)).toEqual(outsiderWritesBeforeRevoke);

      const recipientReply = await compose(request, employeeToken, {
        recipients: [{ userId: adminUserId, type: 'to' }],
        subject: `TC-API-MSG-022 employee reply ${stamp}`,
        body: 'The recipient replies through compose',
        parentMessageId: parentId,
      });
      expect(recipientReply.status, 'the parent recipient can compose onto it').toBe(201);
      expect(recipientReply.body?.threadId).toBe(parentThreadId);
      const recipientReplyId = recipientReply.body?.id as string;
      expect((await readThreadLineage(recipientReplyId)).parentMessageId).toBe(parentId);

      const senderReply = await compose(request, adminToken, {
        recipients: [{ userId: employeeUserId, type: 'to' }],
        subject: `TC-API-MSG-022 sender follow-up ${stamp}`,
        body: 'The sender follows up through compose',
        parentMessageId: parentId,
      });
      expect(senderReply.status, 'the parent sender can compose onto it').toBe(201);
      expect(senderReply.body?.threadId).toBe(parentThreadId);

      await withClient(async (client) => {
        await client.query('update messages set deleted_at = now() where id = $1', [parentId]);
      });
      const deletedParent = await compose(request, employeeToken, {
        recipients: [{ userId: adminUserId, type: 'to' }],
        subject: `TC-API-MSG-022 deleted parent ${stamp}`,
        body: 'Reply onto a deleted message',
        parentMessageId: parentId,
      });
      expect(deletedParent.status, 'a deleted parent is refused even for its recipient').toBe(404);
      expect(deletedParent.body, 'a deleted parent answers exactly like an unknown id').toEqual(unknown.body);
    } finally {
      await deleteMessagesQuietly(rawMessageIds);
      await deleteUserIfExists(request, adminToken, outsiderId);
      await deleteRoleIfExists(request, adminToken, roleId);
    }
  });
});
