import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { composeInternalMessage, deleteMessageIfExists } from './helpers';

/**
 * TC-MSG-003: Reply From Message Detail
 * Source: .ai/qa/scenarios/TC-MSG-003-reply-from-message-detail.md
 */
test.describe('TC-MSG-003: Reply From Message Detail', () => {
  test('should create a reply from detail and show it in unified conversation list', async ({ page, request }) => {
    let messageId: string | null = null;
    let adminToken: string | null = null;

    const replyBody = `QA TC-MSG-003 reply ${Date.now()}`;

    try {
      const fixture = await composeInternalMessage(request, {
        subject: `QA TC-MSG-003 ${Date.now()}`,
        senderRole: 'superadmin',
        recipientRole: 'admin',
      });
      messageId = fixture.messageId;
      adminToken = fixture.senderToken;

      await login(page, 'admin');
      await page.goto(`/backend/messages/${fixture.messageId}`);

      // Two "Reply" IconButtons exist: MainMessageHeader utility action + MessageHeader utility action.
      // .first() targets the MainMessageHeader button which opens the inline reply composer.
      await page.getByRole('button', { name: 'Reply' }).first().click();

      // Inline composer opens — no dialog in the current UI.
      await expect(page.getByPlaceholder('Write your reply...')).toBeVisible();
      await page.getByPlaceholder('Write your reply...').fill(replyBody);
      await page.getByPlaceholder('Write your reply...').press('Control+Enter');

      await expect(page.getByText('Reply sent.').first()).toBeVisible();

      // Inline reply does not navigate; page stays on the original message URL.
      await expect(page).toHaveURL(new RegExp(`/backend/messages/${fixture.messageId}$`, 'i'));

      // After refetch, the reply body is visible in the conversation thread.
      await expect(page.getByText(replyBody).first()).toBeVisible();
    } finally {
      await deleteMessageIfExists(request, adminToken, messageId);
    }
  });
});
