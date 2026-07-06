import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  composeMessageWithToken,
  decodeJwtSubject,
  deleteMessageIfExists,
  uploadAttachmentToMessage,
} from './helpers';

/**
 * TC-API-MSG-017: Attachment Management on Draft Messages
 * Surface: packages/core/src/modules/messages/api/[id]/attachments/route.ts (GET/POST/DELETE)
 *
 * Drafts support listing, linking, and unlinking attachments. Linking
 * re-parents an existing attachment to the draft; unlinking hard-deletes the
 * association row. Only the sender may mutate; mutations are rejected with 409
 * once the message is no longer a draft.
 */
test.describe('TC-API-MSG-017: Attachment Management on Draft Messages', () => {
  test('should list, link, and unlink draft attachments with sender/draft guards', async ({ request }) => {
    let draftId: string | null = null;
    let sentId: string | null = null;
    let adminToken: string | null = null;

    try {
      adminToken = await getAuthToken(request, 'admin');
      const employeeToken = await getAuthToken(request, 'employee');
      const employeeUserId = decodeJwtSubject(employeeToken);

      const timestamp = Date.now();
      draftId = await composeMessageWithToken(request, adminToken, {
        isDraft: true,
        recipients: [{ userId: employeeUserId, type: 'to' }],
        subject: `QA TC-API-MSG-017 draft ${timestamp}`,
        body: 'Draft body content',
        sendViaEmail: false,
      });

      // Upload an attachment directly onto the draft (record_id = draftId).
      const directAttachmentId = await uploadAttachmentToMessage(request, adminToken, draftId, {
        fileName: `tc-api-msg-017-direct-${timestamp}.txt`,
      });

      const listWithDirect = await apiRequest(request, 'GET', `/api/messages/${draftId}/attachments`, {
        token: adminToken,
      });
      expect(listWithDirect.status()).toBe(200);
      const listWithDirectBody = (await listWithDirect.json()) as {
        attachments?: Array<{ id?: unknown; fileName?: unknown; url?: unknown }>;
      };
      const directItem = (listWithDirectBody.attachments ?? []).find((item) => item.id === directAttachmentId);
      expect(directItem).toBeTruthy();
      expect(typeof directItem?.fileName).toBe('string');
      expect(typeof directItem?.url).toBe('string');

      // Unlink hard-deletes the association — the listing is empty again.
      const unlinkDirect = await apiRequest(request, 'DELETE', `/api/messages/${draftId}/attachments`, {
        token: adminToken,
        data: { attachmentIds: [directAttachmentId] },
      });
      expect(unlinkDirect.status()).toBe(200);
      expect(((await unlinkDirect.json()) as { ok?: unknown }).ok).toBe(true);
      expect(unlinkDirect.headers()['x-om-operation']).toBeTruthy();

      const listAfterUnlink = await apiRequest(request, 'GET', `/api/messages/${draftId}/attachments`, {
        token: adminToken,
      });
      const listAfterUnlinkBody = (await listAfterUnlink.json()) as { attachments?: Array<{ id?: unknown }> };
      expect((listAfterUnlinkBody.attachments ?? []).some((item) => item.id === directAttachmentId)).toBe(false);

      // Upload a second attachment against a neutral record, then LINK it to the draft.
      const linkableAttachmentId = await uploadAttachmentToMessage(request, adminToken, randomUUID(), {
        fileName: `tc-api-msg-017-linkable-${timestamp}.txt`,
      });

      const linkResponse = await apiRequest(request, 'POST', `/api/messages/${draftId}/attachments`, {
        token: adminToken,
        data: { attachmentIds: [linkableAttachmentId] },
      });
      expect(linkResponse.status()).toBe(200);
      expect(((await linkResponse.json()) as { ok?: unknown }).ok).toBe(true);
      expect(linkResponse.headers()['x-om-operation']).toBeTruthy();

      const listAfterLink = await apiRequest(request, 'GET', `/api/messages/${draftId}/attachments`, {
        token: adminToken,
      });
      const listAfterLinkBody = (await listAfterLink.json()) as { attachments?: Array<{ id?: unknown }> };
      expect((listAfterLinkBody.attachments ?? []).some((item) => item.id === linkableAttachmentId)).toBe(true);

      // Non-sender cannot mutate draft attachments -> 403.
      const employeeLink = await apiRequest(request, 'POST', `/api/messages/${draftId}/attachments`, {
        token: employeeToken,
        data: { attachmentIds: [linkableAttachmentId] },
      });
      expect(employeeLink.status()).toBe(403);

      // Clean up the linked attachment (also exercises unlink a second time).
      const unlinkLinked = await apiRequest(request, 'DELETE', `/api/messages/${draftId}/attachments`, {
        token: adminToken,
        data: { attachmentIds: [linkableAttachmentId] },
      });
      expect(unlinkLinked.status()).toBe(200);

      // Sent (non-draft) messages reject attachment mutations with 409.
      sentId = await composeMessageWithToken(request, adminToken, {
        recipients: [{ userId: employeeUserId, type: 'to' }],
        subject: `QA TC-API-MSG-017 sent ${timestamp}`,
        body: 'Sent body content',
        sendViaEmail: false,
      });
      const linkOnSent = await apiRequest(request, 'POST', `/api/messages/${sentId}/attachments`, {
        token: adminToken,
        data: { attachmentIds: [randomUUID()] },
      });
      expect(linkOnSent.status()).toBe(409);
      const linkOnSentBody = (await linkOnSent.json()) as { error?: unknown };
      expect(typeof linkOnSentBody.error).toBe('string');
    } finally {
      await deleteMessageIfExists(request, adminToken, draftId);
      await deleteMessageIfExists(request, adminToken, sentId);
    }
  });
});
