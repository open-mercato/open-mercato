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
      await expect(page.getByRole('button', { name: 'Mark unread' })).toBeVisible();

      await page.getByRole('button', { name: 'Mark unread' }).click();

      await page.goto('/backend/messages');
      await searchMessages(page, fixture.subject);
      const messageRow = messageRowBySubject(page, fixture.subject);
      await expect(messageRow).toBeVisible();
      await expect(messageRow.locator('span.font-semibold').filter({ hasText: fixture.subject })).toBeVisible();
    } finally {
      await deleteMessageIfExists(request, adminToken, messageId);
    }
  });
});
