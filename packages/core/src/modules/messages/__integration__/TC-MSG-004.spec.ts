import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  composeInternalMessage,
  decodeJwtSubject,
  deleteMessageIfExists,
  uploadAttachmentToMessage,
} from './helpers';

/**
 * TC-MSG-004: Forward Message With Attachments
 * Source: .ai/qa/scenarios/TC-MSG-004-forward-message-with-attachments.md
 */
test.describe('TC-MSG-004: Forward Message With Attachments', () => {
  test('should forward message and carry over attachments when includeAttachments is enabled', async ({ page, request }) => {
    let originalMessageId: string | null = null;
    let forwardedMessageId: string | null = null;
    let adminToken: string | null = null;

    const attachmentName = `tc-msg-004-${Date.now()}.txt`;
    const forwardNote = `Forward note ${Date.now()}`;

    try {
      const fixture = await composeInternalMessage(request, {
        subject: `QA TC-MSG-004 ${Date.now()}`,
      });
      originalMessageId = fixture.messageId;
      adminToken = fixture.senderToken;

      await uploadAttachmentToMessage(request, fixture.senderToken, fixture.messageId, {
        fileName: attachmentName,
      });

      const employeeUserId = decodeJwtSubject(fixture.recipientToken);
      const forwardResponse = await apiRequest(request, 'POST', `/api/messages/${fixture.messageId}/forward`, {
        token: fixture.senderToken,
        data: {
          recipients: [{ userId: employeeUserId, type: 'to' }],
          additionalBody: forwardNote,
          includeAttachments: true,
          sendViaEmail: false,
        },
      });
      expect(forwardResponse.status()).toBe(201);
      const forwardBody = (await forwardResponse.json()) as { id?: unknown };
      expect(typeof forwardBody.id).toBe('string');
      forwardedMessageId = forwardBody.id as string;

      await login(page, 'admin');
      await page.goto(`/backend/messages/${forwardedMessageId}`);

      await expect(page.getByRole('heading', { name: 'Attachments' })).toBeVisible();
      await expect(page.getByText(attachmentName)).toBeVisible();
    } finally {
      await deleteMessageIfExists(request, adminToken, forwardedMessageId);
      await deleteMessageIfExists(request, adminToken, originalMessageId);
    }
  });
});
