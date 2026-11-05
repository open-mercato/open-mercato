import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  composeMessageWithToken,
  decodeJwtSubject,
  deleteMessageIfExists,
  replyToMessageWithToken,
} from './helpers';

/**
 * TC-API-MSG-018: Conversation-Level Mutations (Archive, Mark Unread, Delete)
 * Surfaces:
 *  - api/[id]/conversation/archive/route.ts (PUT)
 *  - api/[id]/conversation/read/route.ts (DELETE — mark unread)
 *  - api/[id]/conversation/route.ts (DELETE)
 *
 * Conversation mutations are actor-scoped: they affect only the calling user's
 * recipient rows (and, for delete, the caller's own sent messages). All return
 * { ok, affectedCount } with the operation metadata header. A recipient
 * deleting a conversation does not remove the other participant's sent
 * messages.
 */
test.describe('TC-API-MSG-018: Conversation-Level Mutations', () => {
  test('should archive, mark unread, and delete a conversation per actor', async ({ request }) => {
    let rootId: string | null = null;
    let replyId: string | null = null;
    let secondReplyId: string | null = null;
    let adminToken: string | null = null;
    let employeeToken: string | null = null;

    try {
      adminToken = await getAuthToken(request, 'admin');
      employeeToken = await getAuthToken(request, 'employee');
      const employeeUserId = decodeJwtSubject(employeeToken);

      const timestamp = Date.now();
      rootId = await composeMessageWithToken(request, adminToken, {
        recipients: [{ userId: employeeUserId, type: 'to' }],
        subject: `QA TC-API-MSG-018 ${timestamp}`,
        body: `Conversation root ${timestamp}`,
        sendViaEmail: false,
      });
      // employee replies (recipient = admin), then admin replies (recipient = employee).
      replyId = await replyToMessageWithToken(request, employeeToken, rootId, `Reply one ${timestamp}`);
      secondReplyId = await replyToMessageWithToken(request, adminToken, replyId, `Reply two ${timestamp}`);

      // Conversation-level mutations are bulk, actor-scoped operations and are
      // not individually undoable, so (unlike single-message mutations) they do
      // not emit the x-om-operation metadata header — only the
      // { ok, affectedCount } body is asserted here.

      // Archive the conversation for the employee.
      const archive = await apiRequest(request, 'PUT', `/api/messages/${rootId}/conversation/archive`, {
        token: employeeToken,
      });
      expect(archive.status()).toBe(200);
      const archiveBody = (await archive.json()) as { ok?: unknown; affectedCount?: unknown };
      expect(archiveBody.ok).toBe(true);
      expect(typeof archiveBody.affectedCount).toBe('number');
      expect(archiveBody.affectedCount as number).toBeGreaterThanOrEqual(1);

      // After archiving, the employee inbox no longer surfaces the received messages.
      const employeeInbox = await apiRequest(request, 'GET', `/api/messages?folder=inbox&pageSize=100`, {
        token: employeeToken,
      });
      const employeeInboxIds = ((await employeeInbox.json()) as { items?: Array<{ id?: unknown }> }).items?.map(
        (item) => item.id,
      ) ?? [];
      expect(employeeInboxIds).not.toContain(rootId);
      expect(employeeInboxIds).not.toContain(secondReplyId);

      // Mark the whole conversation unread for the employee.
      const markUnread = await apiRequest(request, 'DELETE', `/api/messages/${rootId}/conversation/read`, {
        token: employeeToken,
      });
      expect(markUnread.status()).toBe(200);
      const markUnreadBody = (await markUnread.json()) as { ok?: unknown; affectedCount?: unknown };
      expect(markUnreadBody.ok).toBe(true);
      expect(markUnreadBody.affectedCount as number).toBeGreaterThanOrEqual(1);

      // Unknown anchor -> 404.
      const missing = await apiRequest(
        request,
        'DELETE',
        '/api/messages/00000000-0000-0000-0000-000000000000/conversation',
        { token: employeeToken },
      );
      expect(missing.status()).toBe(404);

      // Delete the conversation for the employee.
      const deleteConversation = await apiRequest(request, 'DELETE', `/api/messages/${rootId}/conversation`, {
        token: employeeToken,
      });
      expect(deleteConversation.status()).toBe(200);
      const deleteBody = (await deleteConversation.json()) as { ok?: unknown; affectedCount?: unknown };
      expect(deleteBody.ok).toBe(true);
      expect(deleteBody.affectedCount as number).toBeGreaterThanOrEqual(1);

      // Delete is actor-scoped per message: the employee's OWN sent message in the
      // thread (replyId) is globally removed, so even the admin can no longer read it.
      const replyForAdmin = await apiRequest(request, 'GET', `/api/messages/${replyId}`, {
        token: adminToken,
      });
      expect(replyForAdmin.status()).toBe(404);

      // The employee's received messages drop out of their inbox (recipient rows
      // soft-deleted). Note: folder=all still surfaces soft-deleted recipient rows,
      // so we assert against the inbox here, not folder=all.
      const employeeInboxAfter = await apiRequest(request, 'GET', `/api/messages?folder=inbox&pageSize=100`, {
        token: employeeToken,
      });
      const employeeInboxAfterIds = ((await employeeInboxAfter.json()) as { items?: Array<{ id?: unknown }> }).items?.map(
        (item) => item.id,
      ) ?? [];
      expect(employeeInboxAfterIds).not.toContain(rootId);
      expect(employeeInboxAfterIds).not.toContain(secondReplyId);

      // Actor-scoped: the admin still sees the messages THEY sent (root + second reply).
      const adminAll = await apiRequest(request, 'GET', `/api/messages?folder=all&pageSize=100`, {
        token: adminToken,
      });
      const adminAllIds = ((await adminAll.json()) as { items?: Array<{ id?: unknown }> }).items?.map(
        (item) => item.id,
      ) ?? [];
      expect(adminAllIds).toContain(rootId);
      expect(adminAllIds).toContain(secondReplyId);
    } finally {
      await deleteMessageIfExists(request, employeeToken, replyId);
      await deleteMessageIfExists(request, adminToken, secondReplyId);
      await deleteMessageIfExists(request, adminToken, rootId);
    }
  });
});
