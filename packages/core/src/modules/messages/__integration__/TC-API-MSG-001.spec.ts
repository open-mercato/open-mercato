import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';


function decodeJwtSubject(token: string): string {
  const payloadPart = token.split('.')[1] ?? '';
  const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const decoded = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as { sub?: unknown };
  if (typeof decoded.sub !== 'string' || decoded.sub.length === 0) {
    throw new Error('Auth token does not contain user subject');
  }
  return decoded.sub;
}

async function composeMessage(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  recipientUserId: string,
  subject: string,
) {
  const response = await apiRequest(request, 'POST', '/api/messages', {
    token,
    data: {
      recipients: [{ userId: recipientUserId, type: 'to' }],
      subject,
      body: `Body for ${subject}`,
      sendViaEmail: false,
    },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { id?: unknown };
  expect(typeof body.id).toBe('string');
  return body.id as string;
}

/**
 * TC-API-MSG-001: Compose Message And Mark Read
 * Source: .ai/specs/SPEC-002-2026-01-23-messages-module.md
 */
test.describe('TC-API-MSG-001: Compose Message And Mark Read', () => {
  test('should compose for recipient, list in inbox, and mark as read on detail fetch', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin@acme.com', 'secret');
    const employeeToken = await getAuthToken(request, 'employee@acme.com', 'secret');
    const employeeId = decodeJwtSubject(employeeToken);

    const subject = `QA TC-API-MSG-001 ${Date.now()}`;
    const messageId = await composeMessage(request, adminToken, employeeId, subject);

    const inboxBeforeReadResponse = await apiRequest(
      request,
      'GET',
      `/api/messages?folder=inbox&search=${encodeURIComponent(subject)}&pageSize=20`,
      { token: employeeToken },
    );
    expect(inboxBeforeReadResponse.ok()).toBeTruthy();
    const inboxBeforeRead = (await inboxBeforeReadResponse.json()) as {
      items?: Array<{ id?: unknown; status?: unknown; subject?: unknown }>;
    };

    const unreadItem = inboxBeforeRead.items?.find((item) => item.id === messageId);
    expect(unreadItem).toBeTruthy();
    expect(unreadItem?.subject).toBe(subject);
    expect(unreadItem?.status).toBe('unread');

    const detailResponse = await apiRequest(request, 'GET', `/api/messages/${messageId}`, {
      token: employeeToken,
    });
    expect(detailResponse.ok()).toBeTruthy();
    const detailBody = (await detailResponse.json()) as { id?: unknown; isRead?: unknown };
    expect(detailBody.id).toBe(messageId);
    expect(detailBody.isRead).toBe(true);

    const inboxReadResponse = await apiRequest(
      request,
      'GET',
      `/api/messages?folder=inbox&status=read&search=${encodeURIComponent(subject)}&pageSize=20`,
      { token: employeeToken },
    );
    expect(inboxReadResponse.ok()).toBeTruthy();
    const inboxRead = (await inboxReadResponse.json()) as {
      items?: Array<{ id?: unknown; status?: unknown }>;
    };
    const readItem = inboxRead.items?.find((item) => item.id === messageId);
    expect(readItem).toBeTruthy();
    expect(readItem?.status).toBe('read');
  });
});
