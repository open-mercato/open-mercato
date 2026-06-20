import { expect, test } from '@playwright/test';
import { apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { composeInternalMessage, deleteMessageIfExists } from './helpers';

/**
 * TC-API-MSG-014: Delete Message For Actor Removes Access
 * Surface: packages/core/src/modules/messages/api/[id]/route.ts (DELETE)
 *
 * When the sender deletes a message, `messages.messages.delete_for_actor`
 * soft-deletes the message itself (message.deletedAt), so both sender and
 * recipient lose access (GET filters deletedAt: null). The response carries
 * the operation metadata header. A missing message id returns 404.
 */
test.describe('TC-API-MSG-014: Delete Message For Actor Removes Access', () => {
  test('should remove access for sender and recipient after sender delete', async ({ request }) => {
    let messageId: string | null = null;
    let adminToken: string | null = null;

    try {
      const fixture = await composeInternalMessage(request, {
        subject: `QA TC-API-MSG-014 ${Date.now()}`,
      });
      messageId = fixture.messageId;
      adminToken = fixture.senderToken;
      const recipientToken = fixture.recipientToken;

      // Recipient can read it before deletion (sanity check on access).
      const preDeleteRecipient = await apiRequest(request, 'GET', `/api/messages/${messageId}?skipMarkRead=1`, {
        token: recipientToken,
      });
      expect(preDeleteRecipient.status()).toBe(200);

      // Deleting an unknown id returns 404, not a 500.
      const missingDelete = await apiRequest(
        request,
        'DELETE',
        '/api/messages/00000000-0000-0000-0000-000000000000',
        { token: adminToken },
      );
      expect(missingDelete.status()).toBe(404);

      // Sender deletes the message.
      const deleteResponse = await apiRequest(request, 'DELETE', `/api/messages/${messageId}`, {
        token: adminToken,
      });
      expect(deleteResponse.status()).toBe(200);
      const deleteBody = (await deleteResponse.json()) as { ok?: unknown };
      expect(deleteBody.ok).toBe(true);
      // Operation metadata header is attached for undo/audit wiring.
      expect(deleteResponse.headers()['x-om-operation']).toBeTruthy();

      // Both sender and recipient now get 404 on detail access.
      const senderDetail = await apiRequest(request, 'GET', `/api/messages/${messageId}`, {
        token: adminToken,
      });
      expect(senderDetail.status()).toBe(404);

      const recipientDetail = await apiRequest(request, 'GET', `/api/messages/${messageId}?skipMarkRead=1`, {
        token: recipientToken,
      });
      expect(recipientDetail.status()).toBe(404);

      // The deleted message is gone from the recipient inbox listing.
      const inboxResponse = await apiRequest(
        request,
        'GET',
        `/api/messages?folder=inbox&pageSize=100`,
        { token: recipientToken },
      );
      expect(inboxResponse.ok()).toBeTruthy();
      const inboxBody = (await inboxResponse.json()) as { items?: Array<{ id?: unknown }> };
      const inboxIds = (inboxBody.items ?? []).map((item) => item.id);
      expect(inboxIds).not.toContain(messageId);

      // Already deleted — clear the cleanup handle so finally does not double-delete.
      messageId = null;
    } finally {
      await deleteMessageIfExists(request, adminToken, messageId);
    }
  });
});
