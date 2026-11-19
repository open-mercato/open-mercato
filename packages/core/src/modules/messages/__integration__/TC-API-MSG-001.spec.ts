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

type InboxItem = { id?: unknown; status?: unknown; subject?: unknown };

/**
 * Poll the inbox search until the composed message shows up.
 *
 * Two independent asynchronous layers sit between a 201 from `POST /api/messages`
 * and that message being findable by `?search=`:
 *
 * 1. `search` is resolved through the `search_tokens` index
 *    (`findMessageIdsBySearchTokens` in `messages/api/route.ts`), which an
 *    ephemeral subscriber populates after the compose request has returned. A
 *    single read straight after composing can therefore observe an empty index.
 * 2. The list response is cached for `MESSAGE_LIST_CACHE_TTL_MS` (30s) under a
 *    key derived from the parsed query, and nothing invalidates that entry when
 *    the indexer catches up. Re-requesting the identical URL would keep
 *    replaying the pre-index miss for the whole poll window, so `pageSize` is
 *    varied per attempt to land on a fresh cache key. It stays within the
 *    endpoint's limits and does not change what the search matches.
 */
async function pollInboxItem(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  subject: string,
  messageId: string,
  extraFilters = '',
): Promise<InboxItem> {
  let attempt = 0;
  let found: InboxItem | undefined;

  await expect
    .poll(
      async () => {
        const pageSize = 20 + (attempt++ % 60);
        const response = await apiRequest(
          request,
          'GET',
          `/api/messages?folder=inbox${extraFilters}&search=${encodeURIComponent(subject)}&pageSize=${pageSize}`,
          { token },
        );
        expect(response.ok(), `inbox list should succeed (status ${response.status()})`).toBeTruthy();
        const body = (await response.json()) as { items?: InboxItem[] };
        found = body.items?.find((item) => item.id === messageId);
        return found !== undefined;
      },
      {
        timeout: 8_000,
        message: `composed message ${messageId} should be listed by the inbox search once indexing settles`,
      },
    )
    .toBe(true);

  return found as InboxItem;
}

/**
 * TC-API-MSG-001: Compose Message And Mark Read
 * Source: .ai/specs/SPEC-002-2026-01-23-messages-module.md
 */
test.describe('TC-API-MSG-001: Compose Message And Mark Read', () => {
  test('should compose for recipient, list in inbox, and mark as read on detail fetch', async ({ request }) => {
    // Two indexing barriers can each spend up to 8s before failing, which would
    // not fit the config's 20s per-test budget. Same reason TC-RESO-009 is slow.
    test.slow();
    const adminToken = await getAuthToken(request, 'admin@acme.com', 'secret');
    const employeeToken = await getAuthToken(request, 'employee@acme.com', 'secret');
    const employeeId = decodeJwtSubject(employeeToken);

    const subject = `QA TC-API-MSG-001 ${Date.now()}`;
    const messageId = await composeMessage(request, adminToken, employeeId, subject);

    const unreadItem = await pollInboxItem(request, employeeToken, subject, messageId);
    expect(unreadItem.subject).toBe(subject);
    expect(unreadItem.status).toBe('unread');

    const detailResponse = await apiRequest(request, 'GET', `/api/messages/${messageId}`, {
      token: employeeToken,
    });
    expect(detailResponse.ok()).toBeTruthy();
    const detailBody = (await detailResponse.json()) as { id?: unknown; isRead?: unknown };
    expect(detailBody.id).toBe(messageId);
    expect(detailBody.isRead).toBe(true);

    const readItem = await pollInboxItem(request, employeeToken, subject, messageId, '&status=read');
    expect(readItem.status).toBe('read');
  });
});
