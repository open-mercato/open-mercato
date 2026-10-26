import { expect, test } from '@playwright/test';
import { apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  expectOperation,
  skipIfUndoTestsDisabled,
  undoOk,
} from '@open-mercato/core/helpers/integration/undoHarness';
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures';
import { composeInternalMessage, decodeJwtSubject, deleteMessageIfExists } from './helpers';

/**
 * TC-API-MSG-023: Undoing a recipient-only delete keeps a later global delete
 * Surfaces:
 *  - api/[id]/route.ts (DELETE) via messages.messages.delete_for_actor
 *  - POST /api/audit_logs/audit-logs/actions/undo
 *
 * A recipient deleting a message only hides it for themselves. If the sender
 * then deletes the message for everyone, the recipient undoing their own
 * earlier delete must restore only their recipient row and must not bring the
 * globally deleted message back for every participant.
 */
test.describe('TC-API-MSG-023: Recipient delete undo keeps the sender global delete', () => {
  test('recipient undo after a sender global delete leaves the message deleted', async ({ request }) => {
    skipIfUndoTestsDisabled();
    let messageId: string | null = null;
    let senderToken: string | null = null;

    try {
      const composed = await composeInternalMessage(request, {
        subject: `QA TC-API-MSG-023 ${Date.now()}`,
      });
      messageId = composed.messageId;
      senderToken = composed.senderToken;
      const recipientToken = composed.recipientToken;
      const recipientUserId = decodeJwtSubject(recipientToken);

      const recipientDelete = await apiRequest(request, 'DELETE', `/api/messages/${messageId}`, {
        token: recipientToken,
      });
      expect(recipientDelete.status()).toBe(200);
      const recipientDeleteOperation = expectOperation(recipientDelete, 'recipient-only delete');
      expect(recipientDeleteOperation.commandId).toBe('messages.messages.delete_for_actor');

      const senderDetailAfterRecipientDelete = await apiRequest(request, 'GET', `/api/messages/${messageId}`, {
        token: senderToken,
      });
      expect(senderDetailAfterRecipientDelete.status()).toBe(200);

      const senderDelete = await apiRequest(request, 'DELETE', `/api/messages/${messageId}`, {
        token: senderToken,
      });
      expect(senderDelete.status()).toBe(200);

      const senderDetailAfterGlobalDelete = await apiRequest(request, 'GET', `/api/messages/${messageId}`, {
        token: senderToken,
      });
      expect(senderDetailAfterGlobalDelete.status()).toBe(404);

      await undoOk(request, recipientToken, recipientDeleteOperation.undoToken, 'recipient-only delete');

      const senderDetailAfterUndo = await apiRequest(request, 'GET', `/api/messages/${messageId}`, {
        token: senderToken,
      });
      expect(
        senderDetailAfterUndo.status(),
        'the sender global delete must survive the recipient undo',
      ).toBe(404);

      const recipientDetailAfterUndo = await apiRequest(
        request,
        'GET',
        `/api/messages/${messageId}?skipMarkRead=1`,
        { token: recipientToken },
      );
      expect(recipientDetailAfterUndo.status()).toBe(404);

      const persisted = await withClient(async (client) => {
        const messageRows = await client.query<{ deleted_at: Date | null }>(
          'select deleted_at from messages where id = $1',
          [messageId],
        );
        const recipientRows = await client.query<{ status: string; deleted_at: Date | null }>(
          'select status, deleted_at from message_recipients where message_id = $1 and recipient_user_id = $2',
          [messageId, recipientUserId],
        );
        return { message: messageRows.rows[0], recipient: recipientRows.rows[0] };
      });
      expect(persisted.message?.deleted_at, 'messages.deleted_at stays set after the recipient undo').not.toBeNull();
      expect(persisted.recipient?.deleted_at, 'the recipient row itself is restored').toBeNull();
      expect(persisted.recipient?.status).toBe('unread');
    } finally {
      await deleteMessageIfExists(request, senderToken, messageId);
    }
  });
});
