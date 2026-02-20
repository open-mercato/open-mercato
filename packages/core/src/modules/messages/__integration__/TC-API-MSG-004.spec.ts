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

async function composeActionMessage(
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
      actionData: {
        actions: [
          {
            id: 'ack',
            label: 'Acknowledge',
            href: '/backend/messages',
            isTerminal: true,
          },
        ],
      },
    },
  });

  expect(response.status()).toBe(201);
  const body = (await response.json()) as { id?: unknown };
  expect(typeof body.id).toBe('string');
  return body.id as string;
}

/**
 * TC-API-MSG-004: Terminal Action Can Be Executed Once
 * Source: .ai/specs/SPEC-002-2026-01-23-messages-module.md
 */
test.describe('TC-API-MSG-004: Terminal Action Can Be Executed Once', () => {
  test('should return 409 when terminal action is executed twice', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin@acme.com', 'secret');
    const employeeToken = await getAuthToken(request, 'employee@acme.com', 'secret');
    const employeeId = decodeJwtSubject(employeeToken);

    const subject = `QA TC-API-MSG-004 ${Date.now()}`;
    const messageId = await composeActionMessage(request, adminToken, employeeId, subject);

    const firstActionResponse = await apiRequest(request, 'POST', `/api/messages/${messageId}/actions/ack`, {
      token: employeeToken,
      data: {},
    });
    expect(firstActionResponse.status()).toBe(200);
    expect((await firstActionResponse.json()) as { ok?: unknown; actionId?: unknown }).toMatchObject({
      ok: true,
      actionId: 'ack',
    });

    const secondActionResponse = await apiRequest(request, 'POST', `/api/messages/${messageId}/actions/ack`, {
      token: employeeToken,
      data: {},
    });
    expect(secondActionResponse.status()).toBe(409);
    const secondActionBody = (await secondActionResponse.json()) as {
      error?: unknown;
      actionTaken?: unknown;
    };
    expect(secondActionBody.error).toBe('Action already taken');
    expect(secondActionBody.actionTaken).toBe('ack');

    const detailResponse = await apiRequest(request, 'GET', `/api/messages/${messageId}`, {
      token: employeeToken,
    });
    expect(detailResponse.status()).toBe(200);
    const detailBody = (await detailResponse.json()) as { actionTaken?: unknown };
    expect(detailBody.actionTaken).toBe('ack');
  });
});
