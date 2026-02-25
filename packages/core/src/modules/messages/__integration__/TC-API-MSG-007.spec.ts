import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { decodeJwtSubject, deleteMessageIfExists } from './helpers';

test.describe('TC-API-MSG-007: Conversation Header Mutation Endpoints', () => {
  test('should archive, mark unread, and delete conversation scope for current actor', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin');
    const employeeToken = await getAuthToken(request, 'employee');
    const adminUserId = decodeJwtSubject(adminToken);
    const employeeUserId = decodeJwtSubject(employeeToken);

    let rootMessageId: string | null = null;
    let replyMessageId: string | null = null;
    let latestMessageId: string | null = null;

    try {
      const timestamp = Date.now();
      const subject = `QA TC-API-MSG-007 ${timestamp}`;

      const rootResponse = await apiRequest(request, 'POST', '/api/messages', {
        token: adminToken,
        data: {
          recipients: [{ userId: employeeUserId, type: 'to' }],
          subject,
          body: `Root body ${timestamp}`,
          sendViaEmail: false,
        },
      });
      expect(rootResponse.status()).toBe(201);
      rootMessageId = ((await rootResponse.json()) as { id?: string }).id ?? null;
      expect(typeof rootMessageId).toBe('string');

      const replyResponse = await apiRequest(request, 'POST', `/api/messages/${rootMessageId}/reply`, {
        token: employeeToken,
        data: {
          body: `Reply body ${timestamp}`,
          sendViaEmail: false,
        },
      });
      expect(replyResponse.status()).toBe(201);
      replyMessageId = ((await replyResponse.json()) as { id?: string }).id ?? null;
      expect(typeof replyMessageId).toBe('string');

      const latestResponse = await apiRequest(request, 'POST', `/api/messages/${replyMessageId}/reply`, {
        token: adminToken,
        data: {
          recipients: [{ userId: employeeUserId, type: 'to' }],
          body: `Latest body ${timestamp}`,
          sendViaEmail: false,
        },
      });
      expect(latestResponse.status()).toBe(201);
      latestMessageId = ((await latestResponse.json()) as { id?: string }).id ?? null;
      expect(typeof latestMessageId).toBe('string');

      const markUnreadResponse = await apiRequest(
        request,
        'DELETE',
        `/api/messages/${latestMessageId}/conversation/read`,
        { token: employeeToken },
      );
      expect(markUnreadResponse.status()).toBe(200);
      const markUnreadBody = (await markUnreadResponse.json()) as { ok?: boolean; affectedCount?: number };
      expect(markUnreadBody.ok).toBeTruthy();
      expect((markUnreadBody.affectedCount ?? 0) >= 2).toBeTruthy();

      const rootAfterUnread = await apiRequest(request, 'GET', `/api/messages/${rootMessageId}?skipMarkRead=1`, {
        token: employeeToken,
      });
      expect(rootAfterUnread.status()).toBe(200);
      const rootAfterUnreadBody = (await rootAfterUnread.json()) as { isRead?: boolean };
      expect(rootAfterUnreadBody.isRead).toBe(false);

      const archiveResponse = await apiRequest(
        request,
        'PUT',
        `/api/messages/${latestMessageId}/conversation/archive`,
        { token: employeeToken },
      );
      expect(archiveResponse.status()).toBe(200);
      const archiveBody = (await archiveResponse.json()) as { ok?: boolean; affectedCount?: number };
      expect(archiveBody.ok).toBeTruthy();
      expect((archiveBody.affectedCount ?? 0) >= 2).toBeTruthy();

      const archivedListResponse = await apiRequest(
        request,
        'GET',
        `/api/messages?folder=archived&search=${encodeURIComponent(subject)}&pageSize=100`,
        { token: employeeToken },
      );
      expect(archivedListResponse.status()).toBe(200);
      const archivedListBody = (await archivedListResponse.json()) as { items?: Array<{ id?: unknown }> };
      const archivedIds = (archivedListBody.items ?? [])
        .map((item) => item.id)
        .filter((id): id is string => typeof id === 'string');
      expect(archivedIds).toContain(rootMessageId);
      expect(archivedIds).toContain(latestMessageId);

      const deleteConversationResponse = await apiRequest(
        request,
        'DELETE',
        `/api/messages/${latestMessageId}/conversation`,
        { token: employeeToken },
      );
      expect(deleteConversationResponse.status()).toBe(200);
      const deleteConversationBody = (await deleteConversationResponse.json()) as { ok?: boolean; affectedCount?: number };
      expect(deleteConversationBody.ok).toBeTruthy();
      expect((deleteConversationBody.affectedCount ?? 0) >= 3).toBeTruthy();

      const employeeRootAccess = await apiRequest(request, 'GET', `/api/messages/${rootMessageId}`, {
        token: employeeToken,
      });
      expect([403, 404]).toContain(employeeRootAccess.status());

      const adminStillHasAccess = await apiRequest(request, 'GET', `/api/messages/${latestMessageId}`, {
        token: adminToken,
      });
      expect(adminStillHasAccess.status()).toBe(200);
      const adminDetail = (await adminStillHasAccess.json()) as { senderUserId?: unknown };
      expect(adminDetail.senderUserId).toBe(adminUserId);
    } finally {
      await deleteMessageIfExists(request, adminToken, latestMessageId);
      await deleteMessageIfExists(request, adminToken, replyMessageId);
      await deleteMessageIfExists(request, adminToken, rootMessageId);
    }
  });
});
