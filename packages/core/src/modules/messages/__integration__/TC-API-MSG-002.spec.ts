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
 * TC-API-MSG-002: Reply To Message Thread
 * Source: .ai/specs/SPEC-002-2026-01-23-messages-module.md
 */
test.describe('TC-API-MSG-002: Reply To Message Thread', () => {
  test('should create a reply and include it in thread history', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin@acme.com', 'secret');
    const employeeToken = await getAuthToken(request, 'employee@acme.com', 'secret');
    const employeeId = decodeJwtSubject(employeeToken);

    const subject = `QA TC-API-MSG-002 ${Date.now()}`;
    const originalMessageId = await composeMessage(request, adminToken, employeeId, subject);

    const replyResponse = await apiRequest(request, 'POST', `/api/messages/${originalMessageId}/reply`, {
      token: employeeToken,
      data: {
        body: 'Reply from employee user',
        replyAll: true,
        sendViaEmail: false,
      },
    });

    expect(replyResponse.status()).toBe(201);
    const replyBody = (await replyResponse.json()) as { id?: unknown };
    expect(typeof replyBody.id).toBe('string');
    const replyId = replyBody.id as string;

    const replyDetailResponse = await apiRequest(request, 'GET', `/api/messages/${replyId}`, {
      token: adminToken,
    });
    expect(replyDetailResponse.ok()).toBeTruthy();
    const replyDetail = (await replyDetailResponse.json()) as {
      id?: unknown;
      parentMessageId?: unknown;
      threadId?: unknown;
      thread?: Array<{ id?: unknown }>;
    };

    expect(replyDetail.id).toBe(replyId);
    expect(replyDetail.parentMessageId).toBe(originalMessageId);
    expect(replyDetail.threadId).toBe(originalMessageId);
    const replyThreadIds = (replyDetail.thread ?? []).map((entry) => entry.id);
    expect(replyThreadIds).toContain(replyId);

    const originalDetailResponse = await apiRequest(request, 'GET', `/api/messages/${originalMessageId}`, {
      token: adminToken,
    });
    expect(originalDetailResponse.ok()).toBeTruthy();
    const originalDetail = (await originalDetailResponse.json()) as {
      thread?: Array<{ id?: unknown }>;
    };

    const threadIds = (originalDetail.thread ?? []).map((entry) => entry.id);
    expect(threadIds).toContain(replyId);
  });
});
