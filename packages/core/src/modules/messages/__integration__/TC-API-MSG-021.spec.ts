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
 * TC-API-MSG-021: Terminal Action Is Concurrency-Safe
 * Source: https://github.com/open-mercato/open-mercato/issues/3261
 *
 * Fires two POST requests at the same terminal action simultaneously and asserts
 * exactly one request succeeds while the other receives the existing
 * "Action already taken" 409 response — the target action is reserved before it
 * runs, so concurrent duplicate requests cannot both execute it.
 */
test.describe('TC-API-MSG-021: Terminal Action Is Concurrency-Safe', () => {
  test('should let only one of two concurrent terminal-action requests succeed', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin@acme.com', 'secret');
    const employeeToken = await getAuthToken(request, 'employee@acme.com', 'secret');
    const employeeId = decodeJwtSubject(employeeToken);

    const subject = `QA TC-API-MSG-021 ${Date.now()}`;
    const messageId = await composeActionMessage(request, adminToken, employeeId, subject);

    const [firstResponse, secondResponse] = await Promise.all([
      apiRequest(request, 'POST', `/api/messages/${messageId}/actions/ack`, {
        token: employeeToken,
        data: {},
      }),
      apiRequest(request, 'POST', `/api/messages/${messageId}/actions/ack`, {
        token: employeeToken,
        data: {},
      }),
    ]);

    const responses = [firstResponse, secondResponse];
    const statuses = responses.map((response) => response.status()).sort((a, b) => a - b);

    // Exactly one winner (200) and one loser (409) regardless of timing.
    expect(statuses).toEqual([200, 409]);

    const success = responses.find((response) => response.status() === 200);
    const conflict = responses.find((response) => response.status() === 409);
    expect(success).toBeTruthy();
    expect(conflict).toBeTruthy();

    const successBody = (await success!.json()) as { ok?: unknown; actionId?: unknown };
    expect(successBody).toMatchObject({ ok: true, actionId: 'ack' });

    const conflictBody = (await conflict!.json()) as { error?: unknown; actionTaken?: unknown };
    expect(conflictBody.error).toBe('Action already taken');
    expect(conflictBody.actionTaken).toBe('ack');

    const detailResponse = await apiRequest(request, 'GET', `/api/messages/${messageId}`, {
      token: employeeToken,
    });
    expect(detailResponse.status()).toBe(200);
    const detailBody = (await detailResponse.json()) as { actionTaken?: unknown };
    expect(detailBody.actionTaken).toBe('ack');
  });
});
