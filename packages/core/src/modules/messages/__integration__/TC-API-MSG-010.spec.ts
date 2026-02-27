import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { decodeJwtSubject, deleteMessageIfExists } from './helpers';

/**
 * TC-API-MSG-010: Priority and Source Entity Filtering
 * Verifies:
 * - Compose with priority 'high' → list response includes correct priority field.
 * - Compose with sourceEntityType/sourceEntityId → filter by those fields returns the message.
 * - List filtered by sourceEntityType returns only matching messages.
 */
test.describe('TC-API-MSG-010: Priority and Source Entity Filtering', () => {
  test('should persist priority and source entity fields and support list filtering', async ({ request }) => {
    let highPriorityMessageId: string | null = null;
    let sourceEntityMessageId: string | null = null;
    let adminToken: string | null = null;

    try {
      adminToken = await getAuthToken(request, 'admin');
      const employeeToken = await getAuthToken(request, 'employee');
      const employeeUserId = decodeJwtSubject(employeeToken);

      const timestamp = Date.now();
      const sourceEntityType = `qa.test_entity`;
      const sourceEntityId = crypto.randomUUID();
      const highPrioritySubject = `QA TC-API-MSG-010 priority ${timestamp}`;
      const sourceEntitySubject = `QA TC-API-MSG-010 source ${timestamp}`;

      // Compose with priority 'high'
      const priorityResponse = await apiRequest(request, 'POST', '/api/messages', {
        token: adminToken,
        data: {
          recipients: [{ userId: employeeUserId, type: 'to' }],
          subject: highPrioritySubject,
          body: 'High priority message body',
          priority: 'high',
          sendViaEmail: false,
        },
      });
      expect(priorityResponse.status()).toBe(201);
      const priorityBody = (await priorityResponse.json()) as { id?: unknown };
      highPriorityMessageId = priorityBody.id as string;

      // Verify priority in list (sent folder for admin)
      const sentListResponse = await apiRequest(
        request,
        'GET',
        `/api/messages?folder=sent&search=${encodeURIComponent(highPrioritySubject)}&pageSize=20`,
        { token: adminToken },
      );
      expect(sentListResponse.ok()).toBeTruthy();
      const sentListBody = (await sentListResponse.json()) as {
        items?: Array<{ id?: unknown; priority?: unknown }>;
      };
      const priorityItem = sentListBody.items?.find((item) => item.id === highPriorityMessageId);
      expect(priorityItem).toBeTruthy();
      expect(priorityItem?.priority).toBe('high');

      // Verify priority in message detail
      const detailResponse = await apiRequest(request, 'GET', `/api/messages/${highPriorityMessageId}`, {
        token: adminToken,
      });
      expect(detailResponse.status()).toBe(200);
      const detailBody = (await detailResponse.json()) as { priority?: unknown };
      expect(detailBody.priority).toBe('high');

      // Compose with sourceEntityType and sourceEntityId
      const sourceResponse = await apiRequest(request, 'POST', '/api/messages', {
        token: adminToken,
        data: {
          recipients: [{ userId: employeeUserId, type: 'to' }],
          subject: sourceEntitySubject,
          body: 'Source entity linked message',
          sourceEntityType,
          sourceEntityId,
          sendViaEmail: false,
        },
      });
      expect(sourceResponse.status()).toBe(201);
      const sourceBody = (await sourceResponse.json()) as { id?: unknown };
      sourceEntityMessageId = sourceBody.id as string;

      // Filter list by sourceEntityType — must find our message
      const sourceFilterResponse = await apiRequest(
        request,
        'GET',
        `/api/messages?folder=sent&sourceEntityType=${encodeURIComponent(sourceEntityType)}&pageSize=20`,
        { token: adminToken },
      );
      expect(sourceFilterResponse.ok()).toBeTruthy();
      const sourceFilterBody = (await sourceFilterResponse.json()) as {
        items?: Array<{ id?: unknown; sourceEntityType?: unknown; sourceEntityId?: unknown }>;
      };
      const sourceItem = sourceFilterBody.items?.find((item) => item.id === sourceEntityMessageId);
      expect(sourceItem).toBeTruthy();
      expect(sourceItem?.sourceEntityType).toBe(sourceEntityType);
      expect(sourceItem?.sourceEntityId).toBe(sourceEntityId);

      // Filter list by both sourceEntityType and sourceEntityId
      const exactFilterResponse = await apiRequest(
        request,
        'GET',
        `/api/messages?folder=sent&sourceEntityType=${encodeURIComponent(sourceEntityType)}&sourceEntityId=${encodeURIComponent(sourceEntityId)}&pageSize=20`,
        { token: adminToken },
      );
      expect(exactFilterResponse.ok()).toBeTruthy();
      const exactFilterBody = (await exactFilterResponse.json()) as {
        items?: Array<{ id?: unknown }>;
      };
      const exactItem = exactFilterBody.items?.find((item) => item.id === sourceEntityMessageId);
      expect(exactItem).toBeTruthy();

      // The high-priority message (no source entity) must NOT appear in the source-filtered list
      const highPriorityInSourceFilter = exactFilterBody.items?.find(
        (item) => item.id === highPriorityMessageId,
      );
      expect(highPriorityInSourceFilter).toBeFalsy();
    } finally {
      await deleteMessageIfExists(request, adminToken, highPriorityMessageId);
      await deleteMessageIfExists(request, adminToken, sourceEntityMessageId);
    }
  });
});
