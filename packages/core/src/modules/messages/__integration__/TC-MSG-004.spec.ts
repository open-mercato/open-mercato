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
  test('should forward message and carry over attachments from the selected thread slice when includeAttachments is enabled', async ({ page, request }) => {
    let rootMessageId: string | null = null;
    let selectedMessageId: string | null = null;
    let futureMessageId: string | null = null;
    let forwardedMessageId: string | null = null;
    let adminToken: string | null = null;

    const timestamp = Date.now();
    const rootAttachmentName = `tc-msg-004-root-${timestamp}.txt`;
    const selectedAttachmentName = `tc-msg-004-selected-${timestamp}.txt`;
    const futureAttachmentName = `tc-msg-004-future-${timestamp}.txt`;
    const forwardedBody = `Forwarded edited content ${timestamp}`;

    try {
      const fixture = await composeInternalMessage(request, {
        subject: `QA TC-MSG-004 ${timestamp}`,
      });
      rootMessageId = fixture.messageId;
      adminToken = fixture.senderToken;
      const employeeUserId = decodeJwtSubject(fixture.recipientToken);

      await uploadAttachmentToMessage(request, fixture.senderToken, rootMessageId, {
        fileName: rootAttachmentName,
      });

      const selectedReplyResponse = await apiRequest(request, 'POST', `/api/messages/${rootMessageId}/reply`, {
        token: fixture.recipientToken,
        data: {
          body: `Reply used for forward anchor ${timestamp}`,
          sendViaEmail: false,
        },
      });
      expect(selectedReplyResponse.status()).toBe(201);
      const selectedReplyPayload = (await selectedReplyResponse.json()) as { id?: unknown };
      expect(typeof selectedReplyPayload.id).toBe('string');
      selectedMessageId = selectedReplyPayload.id as string;

      // recipientToken is the employee who lacks attachments.manage; use senderToken (admin) instead.
      await uploadAttachmentToMessage(request, fixture.senderToken, selectedMessageId, {
        fileName: selectedAttachmentName,
      });

      const futureReplyResponse = await apiRequest(request, 'POST', `/api/messages/${selectedMessageId}/reply`, {
        token: fixture.senderToken,
        data: {
          body: `Reply after forward anchor ${timestamp}`,
          sendViaEmail: false,
        },
      });
      expect(futureReplyResponse.status()).toBe(201);
      const futureReplyPayload = (await futureReplyResponse.json()) as { id?: unknown };
      expect(typeof futureReplyPayload.id).toBe('string');
      futureMessageId = futureReplyPayload.id as string;

      await uploadAttachmentToMessage(request, fixture.senderToken, futureMessageId, {
        fileName: futureAttachmentName,
      });

      const forwardResponse = await apiRequest(request, 'POST', `/api/messages/${selectedMessageId}/forward`, {
        token: fixture.senderToken,
        data: {
          recipients: [{ userId: employeeUserId, type: 'to' }],
          body: forwardedBody,
          includeAttachments: true,
          sendViaEmail: false,
        },
      });
      expect(forwardResponse.status()).toBe(201);
      const forwardPayload = (await forwardResponse.json()) as { id?: unknown };
      expect(typeof forwardPayload.id).toBe('string');
      forwardedMessageId = forwardPayload.id as string;

      await login(page, 'admin');
      await page.goto(`/backend/messages/${forwardedMessageId}`);

      await expect(page.locator('main')).toContainText(forwardedBody);
      await expect(page.getByRole('heading', { name: 'Attachments' })).toBeVisible();
      await expect(page.getByText(rootAttachmentName)).toBeVisible();
      await expect(page.getByText(selectedAttachmentName)).toBeVisible();
      await expect(page.getByText(futureAttachmentName)).toHaveCount(0);
    } finally {
      await deleteMessageIfExists(request, adminToken, forwardedMessageId);
      await deleteMessageIfExists(request, adminToken, futureMessageId);
      await deleteMessageIfExists(request, adminToken, selectedMessageId);
      await deleteMessageIfExists(request, adminToken, rootMessageId);
    }
  });
});
