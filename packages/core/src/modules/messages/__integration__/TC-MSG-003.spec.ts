import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { composeInternalMessage, deleteMessageIfExists } from './helpers';

/**
 * TC-MSG-003: Reply From Message Detail
 * Source: .ai/qa/scenarios/TC-MSG-003-reply-from-message-detail.md
 */
test.describe('TC-MSG-003: Reply From Message Detail', () => {
  test('should create a reply from detail and show it in thread timeline', async ({ page, request }) => {
    let originalMessageId: string | null = null;
    let currentMessageId: string | null = null;
    let adminToken: string | null = null;

    const replyBody = `QA TC-MSG-003 reply ${Date.now()}`;

    try {
      const fixture = await composeInternalMessage(request, {
        subject: `QA TC-MSG-003 ${Date.now()}`,
        senderRole: 'superadmin',
        recipientRole: 'admin',
      });
      originalMessageId = fixture.messageId;
      currentMessageId = fixture.messageId;
      adminToken = fixture.senderToken;

      await login(page, 'admin');
      await page.goto(`/backend/messages/${fixture.messageId}`);

      await page.getByRole('button', { name: 'Reply' }).click();

      const dialog = page.getByRole('dialog', { name: 'Reply' });
      await expect(dialog).toBeVisible();
      await dialog.getByPlaceholder('Write your reply...').fill(replyBody);
      await dialog.getByRole('button', { name: 'Reply' }).click();

      await expect(page.getByText('Reply sent.').first()).toBeVisible();
      await expect(page).toHaveURL(/\/backend\/messages\/[0-9a-f-]{36}$/i);

      const url = page.url();
      const match = url.match(/\/backend\/messages\/([0-9a-f-]{36})$/i);
      if (!match) {
        throw new Error(`Could not parse message id from URL: ${url}`);
      }
      currentMessageId = match[1];

      await expect(page.getByRole('heading', { name: 'Thread' })).toBeVisible();
      await expect(page.getByText(replyBody).first()).toBeVisible();
    } finally {
      await deleteMessageIfExists(request, adminToken, currentMessageId);
      if (originalMessageId && currentMessageId !== originalMessageId) {
        await deleteMessageIfExists(request, adminToken, originalMessageId);
      }
    }
  });
});
