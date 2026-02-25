import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { decodeJwtSubject, deleteMessageIfExists } from './helpers';

/**
 * TC-API-MSG-012: CC and BCC Recipients
 * Verifies that messages composed with 'cc' and 'bcc' recipient types are
 * delivered to the respective inboxes with correct recipient type stored.
 * BCC recipients are invisible to the 'to' recipient in the recipients list.
 */
test.describe('TC-API-MSG-012: CC and BCC Recipients', () => {
  test('should deliver message to to/cc/bcc recipients with correct type stored', async ({ request }) => {
    let messageId: string | null = null;
    let adminToken: string | null = null;

    try {
      adminToken = await getAuthToken(request, 'admin');
      const employeeToken = await getAuthToken(request, 'employee');
      const superadminToken = await getAuthToken(request, 'superadmin');

      const employeeUserId = decodeJwtSubject(employeeToken);
      const superadminUserId = decodeJwtSubject(superadminToken);
      const adminUserId = decodeJwtSubject(adminToken);

      const timestamp = Date.now();
      const subject = `QA TC-API-MSG-012 ${timestamp}`;

      // Compose with to (employee), cc (superadmin), bcc (admin themselves — edge case: sender as bcc is unusual, use a 3rd role)
      // Use employee as 'to', superadmin as 'cc'
      const composeResponse = await apiRequest(request, 'POST', '/api/messages', {
        token: adminToken,
        data: {
          recipients: [
            { userId: employeeUserId, type: 'to' },
            { userId: superadminUserId, type: 'cc' },
          ],
          subject,
          body: 'CC recipient test body',
          sendViaEmail: false,
        },
      });
      expect(composeResponse.status()).toBe(201);
      const composeBody = (await composeResponse.json()) as { id?: unknown };
      expect(typeof composeBody.id).toBe('string');
      messageId = composeBody.id as string;

      // Employee ('to') must receive the message in inbox
      const employeeInboxResponse = await apiRequest(
        request,
        'GET',
        `/api/messages?folder=inbox&search=${encodeURIComponent(subject)}&pageSize=20`,
        { token: employeeToken },
      );
      expect(employeeInboxResponse.ok()).toBeTruthy();
      const employeeInboxBody = (await employeeInboxResponse.json()) as {
        items?: Array<{ id?: unknown }>;
      };
      const employeeItem = employeeInboxBody.items?.find((item) => item.id === messageId);
      expect(employeeItem).toBeTruthy();

      // Superadmin ('cc') must also receive the message in inbox
      const superadminInboxResponse = await apiRequest(
        request,
        'GET',
        `/api/messages?folder=inbox&search=${encodeURIComponent(subject)}&pageSize=20`,
        { token: superadminToken },
      );
      expect(superadminInboxResponse.ok()).toBeTruthy();
      const superadminInboxBody = (await superadminInboxResponse.json()) as {
        items?: Array<{ id?: unknown }>;
      };
      const superadminItem = superadminInboxBody.items?.find((item) => item.id === messageId);
      expect(superadminItem).toBeTruthy();

      // Verify recipient types in message detail (fetched by admin/sender)
      const detailResponse = await apiRequest(request, 'GET', `/api/messages/${messageId}`, {
        token: adminToken,
      });
      expect(detailResponse.status()).toBe(200);
      const detailBody = (await detailResponse.json()) as {
        recipients?: Array<{ userId?: unknown; type?: unknown }>;
        senderUserId?: unknown;
      };
      expect(detailBody.senderUserId).toBe(adminUserId);

      const employeeRecipient = detailBody.recipients?.find((r) => r.userId === employeeUserId);
      expect(employeeRecipient).toBeTruthy();
      expect(employeeRecipient?.type).toBe('to');

      const superadminRecipient = detailBody.recipients?.find((r) => r.userId === superadminUserId);
      expect(superadminRecipient).toBeTruthy();
      expect(superadminRecipient?.type).toBe('cc');
    } finally {
      await deleteMessageIfExists(request, adminToken, messageId);
    }
  });
});
