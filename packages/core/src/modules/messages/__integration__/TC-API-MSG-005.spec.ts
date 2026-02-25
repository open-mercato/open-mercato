import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { composeMessageWithToken, decodeJwtSubject } from './helpers';

/**
 * TC-API-MSG-005: Folder All Is Always Actor Scoped
 * Source: security hardening for list route folder=all semantics.
 */
test.describe('TC-API-MSG-005: Folder All Is Always Actor Scoped', () => {
  test('should return only messages sent by or addressed to current user', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin');
    const employeeToken = await getAuthToken(request, 'employee');
    const superadminToken = await getAuthToken(request, 'superadmin');

    const adminUserId = decodeJwtSubject(adminToken);
    const employeeUserId = decodeJwtSubject(employeeToken);

    const timestamp = Date.now();
    const inboxSubject = `QA TC-API-MSG-005 ${timestamp} inbox`;
    const sentSubject = `QA TC-API-MSG-005 ${timestamp} sent`;
    const unrelatedSubject = `QA TC-API-MSG-005 ${timestamp} unrelated`;

    const receivedMessageId = await composeMessageWithToken(request, adminToken, {
      recipients: [{ userId: employeeUserId, type: 'to' }],
      subject: inboxSubject,
      body: `Body for ${inboxSubject}`,
      sendViaEmail: false,
    });

    const sentMessageId = await composeMessageWithToken(request, employeeToken, {
      recipients: [{ userId: adminUserId, type: 'to' }],
      subject: sentSubject,
      body: `Body for ${sentSubject}`,
      sendViaEmail: false,
    });

    const unrelatedMessageId = await composeMessageWithToken(request, superadminToken, {
      recipients: [{ userId: adminUserId, type: 'to' }],
      subject: unrelatedSubject,
      body: `Body for ${unrelatedSubject}`,
      sendViaEmail: false,
    });

    const allForEmployeeResponse = await apiRequest(
      request,
      'GET',
      `/api/messages?folder=all&search=${encodeURIComponent(`QA TC-API-MSG-005 ${timestamp}`)}&pageSize=100`,
      { token: employeeToken },
    );
    expect(allForEmployeeResponse.ok()).toBeTruthy();
    const allForEmployee = (await allForEmployeeResponse.json()) as {
      items?: Array<{ id?: unknown; subject?: unknown }>;
    };
    const ids = (allForEmployee.items ?? [])
      .map((item) => item.id)
      .filter((id): id is string => typeof id === 'string');

    expect(ids).toContain(receivedMessageId);
    expect(ids).toContain(sentMessageId);
    expect(ids).not.toContain(unrelatedMessageId);
  });
});
