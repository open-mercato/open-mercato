import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { composeInternalMessage, deleteMessageIfExists } from './helpers';

/**
 * TC-MSG-015: Sender-Owned Message Archive Action Visibility
 * Source: GitHub issue #3577
 */
test.describe('TC-MSG-015: Sender-Owned Message Archive Action Visibility', () => {
  test('should not show message-level Archive for a message sent by the current user', async ({ page, request }) => {
    let messageId: string | null = null;
    let senderToken: string | null = null;
    let recipientToken: string | null = null;

    try {
      const fixture = await composeInternalMessage(request, {
        subject: `QA TC-MSG-015 ${Date.now()}`,
        senderRole: 'admin',
        recipientRole: 'employee',
      });
      messageId = fixture.messageId;
      senderToken = fixture.senderToken;
      recipientToken = fixture.recipientToken;

      await login(page, 'admin');
      await page.goto(`/backend/messages/${fixture.messageId}`);

      const actionsButton = page.getByRole('button', { name: /^Actions$|ui\.actions\.actions/i }).first();
      await expect(actionsButton).toBeVisible();
      await actionsButton.click();

      await expect(page.getByRole('menuitem', { name: /^Delete$|messages\.actions\.delete/i })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: /^Archive$|messages\.actions\.archive/i })).toHaveCount(0);
    } finally {
      await deleteMessageIfExists(request, senderToken, messageId);
      await deleteMessageIfExists(request, recipientToken, messageId);
    }
  });
});
