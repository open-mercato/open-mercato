import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { composeInternalMessage, deleteMessageIfExists, searchMessages } from './helpers';

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
      });
      messageId = fixture.messageId;
      adminToken = fixture.senderToken;

      await login(page, 'employee');
      await page.goto(`/backend/messages/${fixture.messageId}`);

      await page.getByRole('button', { name: 'Archive' }).click();
      await expect(page.getByRole('button', { name: 'Unarchive' })).toBeVisible();

      await page.goto('/backend/messages');
      await page.getByRole('button', { name: 'Archived' }).click();
      await searchMessages(page, fixture.subject);
      await expect(page.getByRole('row', { name: new RegExp(fixture.subject, 'i') }).first()).toBeVisible();

      await page.getByRole('row', { name: new RegExp(fixture.subject, 'i') }).first().click();
      await page.getByRole('button', { name: 'Unarchive' }).click();
      await expect(page.getByRole('button', { name: 'Archive' })).toBeVisible();

      await page.goto('/backend/messages');
      await page.getByRole('button', { name: 'Inbox' }).click();
      await searchMessages(page, fixture.subject);
      await expect(page.getByRole('row', { name: new RegExp(fixture.subject, 'i') }).first()).toBeVisible();
    } finally {
      await deleteMessageIfExists(request, adminToken, messageId);
    }
  });
});
