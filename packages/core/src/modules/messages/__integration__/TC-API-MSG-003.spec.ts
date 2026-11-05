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

async function listMessageIds(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  folder: 'inbox' | 'archived',
  subject: string,
): Promise<string[]> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/messages?folder=${folder}&search=${encodeURIComponent(subject)}&pageSize=20`,
    { token },
  );
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { items?: Array<{ id?: unknown }> };
  return (body.items ?? [])
    .map((item) => item.id)
    .filter((id): id is string => typeof id === 'string');
}

/**
 * TC-API-MSG-003: Archive And Unarchive Message
 * Source: .ai/specs/SPEC-002-2026-01-23-messages-module.md
 */
test.describe('TC-API-MSG-003: Archive And Unarchive Message', () => {
  test('should move message between inbox and archived folders', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin@acme.com', 'secret');
    const employeeToken = await getAuthToken(request, 'employee@acme.com', 'secret');
    const employeeId = decodeJwtSubject(employeeToken);

    const subject = `QA TC-API-MSG-003 ${Date.now()}`;
    const messageId = await composeMessage(request, adminToken, employeeId, subject);

    const archiveResponse = await apiRequest(request, 'PUT', `/api/messages/${messageId}/archive`, {
      token: employeeToken,
    });
    expect(archiveResponse.status()).toBe(200);
    expect((await archiveResponse.json()) as { ok?: unknown }).toMatchObject({ ok: true });

    const archivedIds = await listMessageIds(request, employeeToken, 'archived', subject);
    expect(archivedIds).toContain(messageId);

    const unarchiveResponse = await apiRequest(request, 'DELETE', `/api/messages/${messageId}/archive`, {
      token: employeeToken,
    });
    expect(unarchiveResponse.status()).toBe(200);
    expect((await unarchiveResponse.json()) as { ok?: unknown }).toMatchObject({ ok: true });

    const archivedIdsAfterUnarchive = await listMessageIds(request, employeeToken, 'archived', subject);
    expect(archivedIdsAfterUnarchive).not.toContain(messageId);

    const inboxIds = await listMessageIds(request, employeeToken, 'inbox', subject);
    expect(inboxIds).toContain(messageId);
  });
});
