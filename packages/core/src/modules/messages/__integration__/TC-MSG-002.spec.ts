import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { composeInternalMessage, deleteMessageIfExists, messageRowBySubject, searchMessages } from './helpers';

/**
 * TC-MSG-002: Inbox Open Mark Read And Mark Unread
 * Source: .ai/qa/scenarios/TC-MSG-002-inbox-open-mark-read-and-mark-unread.md
 *
 * Regression for #3576: "Mark unread" triggered from the message detail page must
 * navigate back to the inbox (Gmail-style) so the page-level auto-mark-read cannot
 * silently re-mark the message as read while the user stays on the detail view.
 */
test.describe('TC-MSG-002: Inbox Open Mark Read And Mark Unread', () => {
  test('should mark unread message as read on open and stay unread after marking unread again', async ({ page, request }) => {
    let messageId: string | null = null;
    let adminToken: string | null = null;
    let recipientToken: string | null = null;

    try {
      const fixture = await composeInternalMessage(request, {
        subject: `QA TC-MSG-002 ${Date.now()}`,
      });
      messageId = fixture.messageId;
      adminToken = fixture.senderToken;
      recipientToken = fixture.recipientToken;

      await login(page, 'employee');
      await page.goto('/backend/messages');
      await searchMessages(page, fixture.subject);
      await messageRowBySubject(page, fixture.subject).click();

      await expect(page).toHaveURL(new RegExp(`/backend/messages/${messageId}$`, 'i'));

      // Use the stable conversation-level actions menu; installations may render either
      // "Mark unread/read" or "Mark all unread/read" labels depending on configuration.
      const conversationActionsButton = page.getByRole('button', {
        name: /Conversation actions|messages\.actions\.conversationActions/i,
      }).first();
      await conversationActionsButton.hover();
      const markUnreadItem = page.getByRole('menuitem', {
        name: /Mark unread|Mark all unread|messages\.actions\.markUnread/i,
      }).first();
      await expect(markUnreadItem).toBeVisible();
      await markUnreadItem.click();

      // #3576: after marking unread the app returns to the inbox list rather than
      // lingering on the detail page (where auto-mark-read would undo the action).
      await expect(page).toHaveURL(/\/backend\/messages\/?$/i);

      // The message must stay unread for the recipient after returning to the inbox.
      const detailResponse = await apiRequest(
        request,
        'GET',
        `/api/messages/${messageId}?skipMarkRead=1`,
        { token: recipientToken },
      );
      expect(detailResponse.ok()).toBeTruthy();
      const detailBody = (await detailResponse.json()) as { isRead?: boolean };
      expect(detailBody.isRead).toBe(false);
    } finally {
      await deleteMessageIfExists(request, adminToken, messageId);
    }
  });
});
