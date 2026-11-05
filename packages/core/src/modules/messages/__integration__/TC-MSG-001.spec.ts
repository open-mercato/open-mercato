import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { composeInternalMessage, deleteMessageIfExists, messageRowBySubject, searchMessages, selectMessageFolder } from './helpers';

/**
 * TC-MSG-001: Compose And Send Internal Message
 * Source: .ai/qa/scenarios/TC-MSG-001-compose-send-internal-message.md
 */
test.describe('TC-MSG-001: Compose And Send Internal Message', () => {
  test('should send internal message and show it in sent folder', async ({ page, request }) => {
    let messageId: string | null = null;
    let adminToken: string | null = null;

    const subject = `QA TC-MSG-001 ${Date.now()}`;

    try {
      const fixture = await composeInternalMessage(request, {
        subject,
      });
      messageId = fixture.messageId;
      adminToken = fixture.senderToken;

      await login(page, 'admin');
      await page.goto('/backend/messages');
      await selectMessageFolder(page, 'Sent');
      await searchMessages(page, subject);

      await expect(messageRowBySubject(page, subject)).toBeVisible();
    } finally {
      await deleteMessageIfExists(request, adminToken, messageId);
    }
  });
});
