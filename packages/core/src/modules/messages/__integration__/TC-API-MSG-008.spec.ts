import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { decodeJwtSubject, deleteMessageIfExists } from './helpers';

/**
 * TC-API-MSG-008: Draft Lifecycle
 * Verifies: create draft (isDraft: true), list in drafts folder (status: 'draft'),
 * update draft subject/body via PATCH, verify draft is invisible in recipient inbox,
 * and PATCH on a non-draft message returns 409.
 */
test.describe('TC-API-MSG-008: Draft Lifecycle', () => {
  test('should create, update, and list draft — with 409 guard on non-draft edit', async ({ request }) => {
    let draftId: string | null = null;
    let sentMessageId: string | null = null;
    let adminToken: string | null = null;

    try {
      adminToken = await getAuthToken(request, 'admin');
      const employeeToken = await getAuthToken(request, 'employee');
      const employeeUserId = decodeJwtSubject(employeeToken);

      const timestamp = Date.now();
      const draftSubject = `QA TC-API-MSG-008 draft ${timestamp}`;
      const updatedSubject = `QA TC-API-MSG-008 updated ${timestamp}`;

      // Create draft
      const createResponse = await apiRequest(request, 'POST', '/api/messages', {
        token: adminToken,
        data: {
          isDraft: true,
          recipients: [{ userId: employeeUserId, type: 'to' }],
          subject: draftSubject,
          body: 'Draft body content',
          sendViaEmail: false,
        },
      });
      expect(createResponse.status()).toBe(201);
      const createBody = (await createResponse.json()) as { id?: unknown };
      expect(typeof createBody.id).toBe('string');
      draftId = createBody.id as string;

      // List in drafts folder — status must be 'draft'
      const draftsResponse = await apiRequest(
        request,
        'GET',
        `/api/messages?folder=drafts&search=${encodeURIComponent(draftSubject)}&pageSize=20`,
        { token: adminToken },
      );
      expect(draftsResponse.ok()).toBeTruthy();
      const draftsBody = (await draftsResponse.json()) as {
        items?: Array<{ id?: unknown; status?: unknown }>;
      };
      const draftItem = draftsBody.items?.find((item) => item.id === draftId);
      expect(draftItem).toBeTruthy();
      expect(draftItem?.status).toBe('draft');

      // Draft must NOT appear in recipient inbox
      const employeeInboxResponse = await apiRequest(
        request,
        'GET',
        `/api/messages?folder=inbox&search=${encodeURIComponent(draftSubject)}&pageSize=20`,
        { token: employeeToken },
      );
      expect(employeeInboxResponse.ok()).toBeTruthy();
      const employeeInboxBody = (await employeeInboxResponse.json()) as {
        items?: Array<{ id?: unknown }>;
      };
      const draftInRecipientInbox = employeeInboxBody.items?.find((item) => item.id === draftId);
      expect(draftInRecipientInbox).toBeFalsy();

      // Update draft via PATCH
      const updateResponse = await apiRequest(request, 'PATCH', `/api/messages/${draftId}`, {
        token: adminToken,
        data: {
          subject: updatedSubject,
          body: 'Updated draft body',
        },
      });
      expect(updateResponse.status()).toBe(200);
      const updateBody = (await updateResponse.json()) as { ok?: unknown };
      expect(updateBody.ok).toBe(true);

      // Verify update reflected in detail
      const detailResponse = await apiRequest(request, 'GET', `/api/messages/${draftId}`, {
        token: adminToken,
      });
      expect(detailResponse.status()).toBe(200);
      const detailBody = (await detailResponse.json()) as {
        subject?: unknown;
        isDraft?: unknown;
        canEditDraft?: unknown;
      };
      expect(detailBody.subject).toBe(updatedSubject);
      expect(detailBody.isDraft).toBe(true);
      expect(detailBody.canEditDraft).toBe(true);

      // PATCH a sent (non-draft) message must return 409
      const sentResponse = await apiRequest(request, 'POST', '/api/messages', {
        token: adminToken,
        data: {
          isDraft: false,
          recipients: [{ userId: employeeUserId, type: 'to' }],
          subject: `QA TC-API-MSG-008 sent ${timestamp}`,
          body: 'Sent message body',
          sendViaEmail: false,
        },
      });
      expect(sentResponse.status()).toBe(201);
      const sentBody = (await sentResponse.json()) as { id?: unknown };
      sentMessageId = sentBody.id as string;

      const patchSentResponse = await apiRequest(request, 'PATCH', `/api/messages/${sentMessageId}`, {
        token: adminToken,
        data: { subject: 'New subject' },
      });
      expect(patchSentResponse.status()).toBe(409);
      const patchSentBody = (await patchSentResponse.json()) as { error?: unknown };
      expect(typeof patchSentBody.error).toBe('string');
    } finally {
      await deleteMessageIfExists(request, adminToken, draftId);
      await deleteMessageIfExists(request, adminToken, sentMessageId);
    }
  });
});
