import { expect, test } from '@playwright/test';
import { apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { composeInternalMessage, deleteMessageIfExists } from './helpers';

/**
 * TC-API-MSG-015: Mark Read and Unread Toggle State
 * Surface: packages/core/src/modules/messages/api/[id]/read/route.ts (PUT/DELETE)
 *
 * Recipient-only state machine: unread -> read (PUT) -> unread (DELETE).
 * `?skipMarkRead=1` reads the detail without the implicit auto-mark-read so the
 * isRead flag can be inspected deterministically. A non-recipient (the sender)
 * cannot toggle read state and receives 403.
 */
test.describe('TC-API-MSG-015: Mark Read and Unread Toggle State', () => {
  test('should toggle read state for the recipient and reject non-recipients', async ({ request }) => {
    let messageId: string | null = null;
    let adminToken: string | null = null;

    try {
      const fixture = await composeInternalMessage(request, {
        subject: `QA TC-API-MSG-015 ${Date.now()}`,
      });
      messageId = fixture.messageId;
      adminToken = fixture.senderToken;
      const recipientToken = fixture.recipientToken;

      // Before any read interaction the recipient inbox shows status=unread.
      // (The list endpoint does not mutate read state.)
      const inboxBefore = await apiRequest(
        request,
        'GET',
        `/api/messages?folder=inbox&pageSize=100`,
        { token: recipientToken },
      );
      expect(inboxBefore.ok()).toBeTruthy();
      const inboxBeforeBody = (await inboxBefore.json()) as {
        items?: Array<{ id?: unknown; status?: unknown }>;
      };
      const inboxItem = inboxBeforeBody.items?.find((item) => item.id === messageId);
      expect(inboxItem).toBeTruthy();
      expect(inboxItem?.status).toBe('unread');

      // A non-recipient (the sender) cannot mark read -> 403.
      const senderMarkRead = await apiRequest(request, 'PUT', `/api/messages/${messageId}/read`, {
        token: adminToken,
      });
      expect(senderMarkRead.status()).toBe(403);

      // Recipient marks read.
      const markRead = await apiRequest(request, 'PUT', `/api/messages/${messageId}/read`, {
        token: recipientToken,
      });
      expect(markRead.status()).toBe(200);
      const markReadBody = (await markRead.json()) as { ok?: unknown };
      expect(markReadBody.ok).toBe(true);
      expect(markRead.headers()['x-om-operation']).toBeTruthy();

      const afterRead = await apiRequest(request, 'GET', `/api/messages/${messageId}?skipMarkRead=1`, {
        token: recipientToken,
      });
      expect(afterRead.status()).toBe(200);
      const afterReadBody = (await afterRead.json()) as { isRead?: unknown };
      expect(afterReadBody.isRead).toBe(true);

      // Recipient marks unread again.
      const markUnread = await apiRequest(request, 'DELETE', `/api/messages/${messageId}/read`, {
        token: recipientToken,
      });
      expect(markUnread.status()).toBe(200);
      const markUnreadBody = (await markUnread.json()) as { ok?: unknown };
      expect(markUnreadBody.ok).toBe(true);
      expect(markUnread.headers()['x-om-operation']).toBeTruthy();

      const afterUnread = await apiRequest(request, 'GET', `/api/messages/${messageId}?skipMarkRead=1`, {
        token: recipientToken,
      });
      expect(afterUnread.status()).toBe(200);
      const afterUnreadBody = (await afterUnread.json()) as { isRead?: unknown };
      expect(afterUnreadBody.isRead).toBe(false);
    } finally {
      await deleteMessageIfExists(request, adminToken, messageId);
    }
  });
});
