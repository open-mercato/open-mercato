import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { composeInternalMessage, deleteMessageIfExists, messageRowBySubject, searchMessages, selectMessageFolder } from './helpers';

/**
 * TC-MSG-005: Archive And Unarchive Message
 * Source: .ai/qa/scenarios/TC-MSG-005-archive-and-unarchive-message.md
 */
test.describe('TC-MSG-005: Archive And Unarchive Message', () => {
  test('should archive message into archived folder and unarchive it back', async ({ page, request }) => {
    let messageId: string | null = null;
    let adminToken: string | null = null;

    try {
      const fixture = await composeInternalMessage(request, {
        subject: `QA TC-MSG-005 ${Date.now()}`,
        recipientRole: 'admin',
      });
      messageId = fixture.messageId;
      adminToken = fixture.senderToken;

      await login(page, 'admin');
      await page.goto(`/backend/messages/${fixture.messageId}`);

      // "Archive" is a menuitem inside the hover-triggered "Actions" dropdown on the individual message header.
      await page.getByRole('button', { name: /^Actions$|ui\.actions\.actions/i }).hover();
      await page.getByRole('menuitem', { name: /^Archive$|messages\.actions\.archive/i }).click();

      // After archiving the menu label switches to "Unarchive".
      await page.getByRole('button', { name: /^Actions$|ui\.actions\.actions/i }).hover();
      await expect(page.getByRole('menuitem', { name: /Unarchive|messages\.actions\.unarchive/i })).toBeVisible();

      await page.goto('/backend/messages');
      await selectMessageFolder(page, 'Archived');
      await searchMessages(page, fixture.subject);
      await expect(messageRowBySubject(page, fixture.subject)).toBeVisible();

      await messageRowBySubject(page, fixture.subject).click();

      await page.getByRole('button', { name: /^Actions$|ui\.actions\.actions/i }).hover();
      await page.getByRole('menuitem', { name: /Unarchive|messages\.actions\.unarchive/i }).click();

      // After unarchiving the menu label switches back to "Archive".
      await page.getByRole('button', { name: /^Actions$|ui\.actions\.actions/i }).hover();
      await expect(page.getByRole('menuitem', { name: /^Archive$|messages\.actions\.archive/i })).toBeVisible();

      await page.goto('/backend/messages');
      await selectMessageFolder(page, 'Inbox');
      await searchMessages(page, fixture.subject);
      await expect(messageRowBySubject(page, fixture.subject)).toBeVisible();
    } finally {
      await deleteMessageIfExists(request, adminToken, messageId);
    }
  });
});
