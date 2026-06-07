import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures';
import { hashAuthToken } from '@open-mercato/core/modules/auth/lib/tokenHash';

export type IntegrationRole = 'admin' | 'employee' | 'superadmin';

export type ComposeMessagePayload = {
  recipients: Array<{ userId: string; type?: 'to' | 'cc' | 'bcc' }>;
  subject: string;
  body: string;
  sendViaEmail?: boolean;
  isDraft?: boolean;
  actionData?: {
    actions: Array<{
      id: string;
      label: string;
      href?: string;
      isTerminal?: boolean;
      confirmRequired?: boolean;
      confirmMessage?: string;
    }>;
  };
};

export function decodeJwtSubject(token: string): string {
  const payloadPart = token.split('.')[1] ?? '';
  const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const decoded = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as { sub?: unknown };
  if (typeof decoded.sub !== 'string' || decoded.sub.length === 0) {
    throw new Error('Auth token does not contain user subject');
  }
  return decoded.sub;
}

export async function getRoleTokens(request: APIRequestContext): Promise<{
  adminToken: string;
  employeeToken: string;
  adminUserId: string;
  employeeUserId: string;
}> {
  const adminToken = await getAuthToken(request, 'admin');
  const employeeToken = await getAuthToken(request, 'employee');

  return {
    adminToken,
    employeeToken,
    adminUserId: decodeJwtSubject(adminToken),
    employeeUserId: decodeJwtSubject(employeeToken),
  };
}

export async function composeMessageWithToken(
  request: APIRequestContext,
  token: string,
  payload: ComposeMessagePayload,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/messages', {
    token,
    data: {
      ...payload,
      sendViaEmail: payload.sendViaEmail ?? false,
    },
  });

  expect(response.status()).toBe(201);
  const body = (await response.json()) as { id?: unknown };
  expect(typeof body.id).toBe('string');
  return body.id as string;
}

export async function composeInternalMessage(
  request: APIRequestContext,
  options?: {
    subject?: string;
    body?: string;
    senderRole?: IntegrationRole;
    recipientRole?: IntegrationRole;
    actionData?: ComposeMessagePayload['actionData'];
  },
): Promise<{
  messageId: string;
  subject: string;
  senderToken: string;
  recipientToken: string;
}> {
  const subject = options?.subject ?? `QA message ${Date.now()}`;
  const body = options?.body ?? `Body for ${subject}`;
  const senderRole = options?.senderRole ?? 'admin';
  const recipientRole = options?.recipientRole ?? 'employee';

  const senderToken = await getAuthToken(request, senderRole);
  const recipientToken = await getAuthToken(request, recipientRole);
  const recipientUserId = decodeJwtSubject(recipientToken);

  const messageId = await composeMessageWithToken(request, senderToken, {
    recipients: [{ userId: recipientUserId, type: 'to' }],
    subject,
    body,
    sendViaEmail: false,
    actionData: options?.actionData,
  });

  return {
    messageId,
    subject,
    senderToken,
    recipientToken,
  };
}

export async function replyToMessageWithToken(
  request: APIRequestContext,
  token: string,
  parentMessageId: string,
  body: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', `/api/messages/${parentMessageId}/reply`, {
    token,
    data: { body, sendViaEmail: false },
  });

  expect(response.status()).toBe(201);
  const payload = (await response.json()) as { id?: unknown };
  expect(typeof payload.id).toBe('string');
  return payload.id as string;
}

export async function uploadAttachmentToMessage(
  request: APIRequestContext,
  token: string,
  messageId: string,
  options?: {
    fileName?: string;
    mimeType?: string;
    content?: string;
  },
): Promise<string> {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const fileName = options?.fileName ?? `qa-message-attachment-${Date.now()}.txt`;
  const mimeType = options?.mimeType ?? 'text/plain';
  const content = options?.content ?? `Attachment for ${messageId}`;

  const response = await request.fetch(`${baseUrl}/api/attachments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    multipart: {
      entityId: 'messages:message',
      recordId: messageId,
      file: {
        name: fileName,
        mimeType,
        buffer: Buffer.from(content, 'utf8'),
      },
    },
  });

  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    item?: { id?: unknown };
  };
  expect(typeof body.item?.id).toBe('string');
  return body.item?.id as string;
}

export async function selectRecipientFromComposer(root: Page | Locator, email: string): Promise<void> {
  const page = 'waitForResponse' in root ? (root as Page) : null;
  const recipientInput = root.getByPlaceholder('Search recipients...');
  const suggestion = root.getByRole('button', { name: new RegExp(escapeRegex(email), 'i') }).first();

  const waitForSuggestionsResponse = () => page?.waitForResponse(
    (response) => response.url().includes('/api/auth/users') && response.status() === 200,
    { timeout: 10_000 },
  );

  await recipientInput.click();
  const emptyQueryResponse = waitForSuggestionsResponse();

  if (emptyQueryResponse) {
    await emptyQueryResponse.catch(() => null);
  }

  if (!(await suggestion.isVisible().catch(() => false))) {
    await recipientInput.fill(email);
    const typedQueryResponse = waitForSuggestionsResponse();
    if (typedQueryResponse) {
      await typedQueryResponse.catch(() => null);
    }
  }

  await expect(suggestion).toBeVisible({ timeout: 10_000 });
  await suggestion.click();
  // Anchor the regex: the DS Tag primitive renders the chip's remove icon as
  // a button with `aria-label="Remove <label>"`, which would otherwise match
  // the same regex used to assert "suggestion gone".
  await expect(root.getByRole('button', { name: new RegExp(`^${escapeRegex(email)}$`, 'i') })).toHaveCount(0);
}

export async function searchMessages(page: Page, searchValue: string): Promise<void> {
  const input = page.getByPlaceholder('Search messages');
  const currentValue = await input.inputValue().catch(() => '');
  const expectedSearch = searchValue.trim();
  if (currentValue.trim() === expectedSearch) {
    await page.waitForTimeout(200);
    return;
  }
  // Register the response listener BEFORE filling so a fast network response is
  // not missed. Accept any /api/messages OK GET — the initial unfiltered load
  // or the debounced search-filtered response — either signals that the table
  // has fresh data. Search tokens are populated by an ephemeral subscriber, so
  // waiting strictly for `search=expected` can resolve against an empty index.
  const listResponsePromise = page.waitForResponse(
    (response) => {
      if (response.request().method() !== 'GET' || !response.ok()) return false;
      const url = new URL(response.url());
      return url.pathname === '/api/messages';
    },
    { timeout: 10_000 },
  ).catch(() => null);
  await input.fill(searchValue);
  await listResponsePromise;
  await page.waitForTimeout(200);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function messageRowBySubject(page: Page, subject: string): Locator {
  return page.getByRole('row', { name: new RegExp(escapeRegex(subject), 'i') }).first();
}

export async function selectMessageRowsBySubject(page: Page, subjects: string[]): Promise<void> {
  for (const subject of subjects) {
    const row = messageRowBySubject(page, subject);
    await expect(row).toBeVisible();
    await row.getByRole('checkbox', { name: /Select row/i }).click();
  }
}

export async function expectFlashMessage(page: Page, message: string): Promise<void> {
  await expect(
    page.locator('div.pointer-events-none.fixed').getByText(message, { exact: true }).first(),
  ).toBeVisible();
}

export async function selectMessageFolder(page: Page, folderLabel: 'Inbox' | 'Sent' | 'Drafts' | 'Archived' | 'All'): Promise<void> {
  const listResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      /\/api\/messages(?:\?|$)/.test(response.url()) &&
      response.ok(),
    { timeout: 5_000 },
  ).catch(() => null);
  await page.getByRole('button', { name: /Folder:/i }).click();
  await page.getByRole('menuitemradio', { name: new RegExp(`^${escapeRegex(folderLabel)}$`, 'i') }).click();
  await listResponsePromise;
  await page.waitForTimeout(200);
}

export async function deleteMessageIfExists(
  request: APIRequestContext,
  token: string | null | undefined,
  messageId: string | null | undefined,
): Promise<void> {
  if (!token || !messageId) return;
  await apiRequest(request, 'DELETE', `/api/messages/${encodeURIComponent(messageId)}`, {
    token,
  }).catch(() => {});
}

// Public message-access tokens are only ever minted internally (the "view in
// browser" email link) and are stored HMAC-SHA-256 hashed at rest, so there is
// no API to obtain a usable raw token in a test. We seed rows directly via the
// shared dbFixtures pg client and store the same hash the route computes from
// the URL token (`hashAuthToken(raw)`), so the route's hashed-only lookup
// matches. The integration run and the app server share `JWT_SECRET`, so the
// hash computed here equals the one the route derives. Callers pass the raw
// sentinel for both seeding and lookup; these helpers hash it internally.
export async function seedMessageAccessToken(input: {
  messageId: string;
  recipientUserId: string;
  token: string;
  expiresAt: Date;
  useCount?: number;
}): Promise<void> {
  await withClient(async (client) => {
    // created_at is NOT NULL without a DB default (MikroORM sets it via onCreate),
    // so a raw insert must provide it explicitly.
    await client.query(
      `insert into message_access_tokens (message_id, recipient_user_id, token, expires_at, use_count, created_at)
       values ($1, $2, $3, $4, $5, now())`,
      [
        input.messageId,
        input.recipientUserId,
        hashAuthToken(input.token),
        input.expiresAt.toISOString(),
        input.useCount ?? 0,
      ],
    );
  });
}

export async function readMessageAccessTokenUseCount(token: string): Promise<number | null> {
  return withClient(async (client) => {
    const result = await client.query<{ use_count: number }>(
      `select use_count from message_access_tokens where token = $1`,
      [hashAuthToken(token)],
    );
    if (result.rows.length === 0) return null;
    return Number(result.rows[0].use_count);
  });
}

export async function deleteMessageAccessTokenIfExists(token: string | null | undefined): Promise<void> {
  if (!token) return;
  await withClient(async (client) => {
    await client.query(`delete from message_access_tokens where token = $1`, [hashAuthToken(token)]);
  }).catch(() => {});
}
