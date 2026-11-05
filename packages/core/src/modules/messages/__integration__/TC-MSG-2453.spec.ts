import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { decodeJwtSubject, deleteMessageIfExists, uploadAttachmentToMessage } from './helpers';

/**
 * TC-MSG-2453: #2453-class interleaved-read scalar-persist proof for
 * `messages.messages.update_draft` (messages/commands/messages.ts).
 *
 * Bug shape (pre-fix): editing a draft's scalar columns (subject/body) while the
 * same PATCH also passes `attachmentIds` forces `linkAttachmentsToMessage` to run
 * an interleaved `em.find` between the scalar mutation and the terminal
 * `em.flush()` inside `withAtomicFlush`. Under MikroORM v7 that read discards the
 * pending changeset, so the UPDATE for subject/body is never issued — the PATCH
 * still returns 200 and `updated_at` is bumped, but the scalar columns silently
 * revert to their old values.
 *
 * CRITICAL TRIGGER: `attachmentIds` MUST be present in the PATCH payload. Without
 * it `linkAttachmentsToMessage` never runs, no interleaved read occurs, and the
 * bug does not reproduce.
 *
 * Assertion: re-fetch via GET and assert EACH changed scalar column (subject,
 * body) round-trips to its NEW value — not merely that the PATCH returned 200.
 */
test.describe('TC-MSG-2453: draft scalar edit persists across interleaved attachment read', () => {
  test('PATCH subject+body WITH attachmentIds persists subject and body', async ({ request }) => {
    let draftId: string | null = null;
    let adminToken: string | null = null;

    try {
      adminToken = await getAuthToken(request, 'admin');
      const employeeToken = await getAuthToken(request, 'employee');
      const employeeUserId = decodeJwtSubject(employeeToken);

      const timestamp = Date.now();
      const originalSubject = `QA TC-MSG-2453 original ${timestamp}`;
      const originalBody = `Original body ${timestamp}`;
      const updatedSubject = `QA TC-MSG-2453 updated ${timestamp}`;
      const updatedBody = `Updated body ${timestamp}`;

      // 1. Create the draft via the API.
      const createResponse = await apiRequest(request, 'POST', '/api/messages', {
        token: adminToken,
        data: {
          isDraft: true,
          recipients: [{ userId: employeeUserId, type: 'to' }],
          subject: originalSubject,
          body: originalBody,
          sendViaEmail: false,
        },
      });
      expect(createResponse.status()).toBe(201);
      const createBody = (await createResponse.json()) as { id?: unknown };
      expect(typeof createBody.id).toBe('string');
      draftId = createBody.id as string;

      // 2. Upload an attachment so we have a real attachment id to replay in the
      //    PATCH — this is what arms the interleaved `linkAttachmentsToMessage`
      //    read path during the scalar edit.
      const attachmentId = await uploadAttachmentToMessage(request, adminToken, draftId, {
        fileName: `qa-2453-${timestamp}.txt`,
        content: `attachment for ${draftId}`,
      });

      // 3. PATCH the draft: change scalar columns (subject + body) AND pass
      //    attachmentIds. The attachmentIds entry is the load-bearing trigger —
      //    it forces the interleaved read inside withAtomicFlush.
      const updateResponse = await apiRequest(request, 'PATCH', `/api/messages/${draftId}`, {
        token: adminToken,
        data: {
          subject: updatedSubject,
          body: updatedBody,
          attachmentIds: [attachmentId],
        },
      });
      expect(updateResponse.status()).toBe(200);
      const updateBody = (await updateResponse.json()) as { ok?: unknown };
      expect(updateBody.ok).toBe(true);

      // 4. Re-fetch and assert EACH changed scalar column round-trips to its new
      //    value. Pre-fix these would still hold the original values despite the
      //    200 response.
      const detailResponse = await apiRequest(
        request,
        'GET',
        `/api/messages/${draftId}?skipMarkRead=1`,
        { token: adminToken },
      );
      expect(detailResponse.status()).toBe(200);
      const detailBody = (await detailResponse.json()) as {
        subject?: unknown;
        body?: unknown;
        isDraft?: unknown;
      };
      expect(detailBody.subject).toBe(updatedSubject);
      expect(detailBody.body).toBe(updatedBody);
      expect(detailBody.isDraft).toBe(true);
    } finally {
      await deleteMessageIfExists(request, adminToken, draftId);
    }
  });
});
