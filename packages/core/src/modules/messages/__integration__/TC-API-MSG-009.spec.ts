import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { decodeJwtSubject, deleteMessageIfExists } from './helpers';

/**
 * TC-API-MSG-009: Unread Count Tracking
 * Verifies: GET /api/messages/unread-count reflects inbox state correctly.
 * Sending a new message increases the recipient's count; opening the detail
 * (auto-mark-read) decreases it back.
 */
test.describe('TC-API-MSG-009: Unread Count Tracking', () => {
  test('should increment unread count on new message and decrement on read', async ({ request }) => {
    let messageId: string | null = null;
    let adminToken: string | null = null;
    let employeeToken: string | null = null;

    try {
      adminToken = await getAuthToken(request, 'admin');
      employeeToken = await getAuthToken(request, 'employee');
      const employeeUserId = decodeJwtSubject(employeeToken);

      // Capture baseline unread count for employee
      const baselineResponse = await apiRequest(request, 'GET', '/api/messages/unread-count', {
        token: employeeToken,
      });
      expect(baselineResponse.ok()).toBeTruthy();
      const baselineBody = (await baselineResponse.json()) as { unreadCount?: unknown };
      expect(typeof baselineBody.unreadCount).toBe('number');
      const baselineCount = baselineBody.unreadCount as number;

      // Send a new message to employee
      const composeResponse = await apiRequest(request, 'POST', '/api/messages', {
        token: adminToken,
        data: {
          recipients: [{ userId: employeeUserId, type: 'to' }],
          subject: `QA TC-API-MSG-009 ${Date.now()}`,
          body: 'Unread count tracking test body',
          sendViaEmail: false,
        },
      });
      expect(composeResponse.status()).toBe(201);
      const composeBody = (await composeResponse.json()) as { id?: unknown };
      messageId = composeBody.id as string;

      // Unread count must have increased by at least 1
      const afterSendResponse = await apiRequest(request, 'GET', '/api/messages/unread-count', {
        token: employeeToken,
      });
      expect(afterSendResponse.ok()).toBeTruthy();
      const afterSendBody = (await afterSendResponse.json()) as { unreadCount?: unknown };
      expect(typeof afterSendBody.unreadCount).toBe('number');
      const countAfterSend = afterSendBody.unreadCount as number;
      expect(countAfterSend).toBeGreaterThanOrEqual(baselineCount + 1);

      // Open detail → auto-marks message as read
      const detailResponse = await apiRequest(request, 'GET', `/api/messages/${messageId}`, {
        token: employeeToken,
      });
      expect(detailResponse.status()).toBe(200);
      const detailBody = (await detailResponse.json()) as { isRead?: unknown };
      expect(detailBody.isRead).toBe(true);

      // Unread count must have decreased back to baseline
      const afterReadResponse = await apiRequest(request, 'GET', '/api/messages/unread-count', {
        token: employeeToken,
      });
      expect(afterReadResponse.ok()).toBeTruthy();
      const afterReadBody = (await afterReadResponse.json()) as { unreadCount?: unknown };
      expect(typeof afterReadBody.unreadCount).toBe('number');
      const countAfterRead = afterReadBody.unreadCount as number;
      expect(countAfterRead).toBe(baselineCount);
    } finally {
      await deleteMessageIfExists(request, adminToken, messageId);
    }
  });
});
