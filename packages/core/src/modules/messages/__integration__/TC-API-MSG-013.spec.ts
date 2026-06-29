import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { composeInternalMessage, deleteMessageIfExists, uploadAttachmentToMessage } from './helpers';

/**
 * TC-API-MSG-013: hasAttachments Filter
 * Regression test for #1942 — filtering by hasAttachments=true caused a 500 error
 * due to a type mismatch (text = uuid) in the correlated subquery.
 */
test.describe('TC-API-MSG-013: hasAttachments Filter', () => {
  test('should return 200 and filter messages by attachment presence', async ({ request }) => {
    let withAttachmentId: string | null = null;
    let withoutAttachmentId: string | null = null;
    let adminToken: string | null = null;

    const timestamp = Date.now();
    const withAttachmentSubject = `QA TC-API-MSG-013 with-attachment ${timestamp}`;
    const withoutAttachmentSubject = `QA TC-API-MSG-013 no-attachment ${timestamp}`;

    try {
      const fixtureWith = await composeInternalMessage(request, { subject: withAttachmentSubject });
      withAttachmentId = fixtureWith.messageId;
      adminToken = fixtureWith.senderToken;

      const fixtureWithout = await composeInternalMessage(request, { subject: withoutAttachmentSubject });
      withoutAttachmentId = fixtureWithout.messageId;

      await uploadAttachmentToMessage(request, adminToken, withAttachmentId, {
        fileName: `tc-api-msg-013-${timestamp}.txt`,
      });

      // hasAttachments=true: must not 500, must include the message with attachment
      const hasAttachmentsResponse = await apiRequest(
        request,
        'GET',
        `/api/messages?folder=all&hasAttachments=true&pageSize=100`,
        { token: adminToken },
      );
      expect(hasAttachmentsResponse.status()).toBe(200);
      const hasAttachmentsBody = (await hasAttachmentsResponse.json()) as {
        items?: Array<{ id?: unknown }>;
      };
      const ids = (hasAttachmentsBody.items ?? []).map((item) => item.id);
      expect(ids).toContain(withAttachmentId);
      expect(ids).not.toContain(withoutAttachmentId);

      // hasAttachments=false: must return the message without attachment
      const noAttachmentsResponse = await apiRequest(
        request,
        'GET',
        `/api/messages?folder=all&hasAttachments=false&pageSize=100`,
        { token: adminToken },
      );
      expect(noAttachmentsResponse.status()).toBe(200);
      const noAttachmentsBody = (await noAttachmentsResponse.json()) as {
        items?: Array<{ id?: unknown }>;
      };
      const noAttachIds = (noAttachmentsBody.items ?? []).map((item) => item.id);
      expect(noAttachIds).toContain(withoutAttachmentId);
      expect(noAttachIds).not.toContain(withAttachmentId);
    } finally {
      await deleteMessageIfExists(request, adminToken, withAttachmentId);
      await deleteMessageIfExists(request, adminToken, withoutAttachmentId);
    }
  });
});
