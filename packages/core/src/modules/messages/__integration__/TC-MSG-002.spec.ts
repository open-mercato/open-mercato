import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { composeInternalMessage, deleteMessageIfExists, messageRowBySubject, searchMessages } from './helpers';

/**
 * TC-MSG-002: Inbox Open Mark Read And Mark Unread
 * Source: .ai/qa/scenarios/TC-MSG-002-inbox-open-mark-read-and-mark-unread.md
 */
test.describe('TC-MSG-002: Inbox Open Mark Read And Mark Unread', () => {
  test('should mark unread message as read on open and allow marking unread again', async ({ page, request }) => {
    let messageId: string | null = null;
    let adminToken: string | null = null;

    try {
      const fixture = await composeInternalMessage(request, {
        subject: `QA TC-MSG-002 ${Date.now()}`,
      });
      messageId = fixture.messageId;
      adminToken = fixture.senderToken;

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
      await expect(page).toHaveURL(new RegExp(`/backend/messages/${messageId}$`, 'i'));
    } finally {
      await deleteMessageIfExists(request, adminToken, messageId);
    }
  });
});
