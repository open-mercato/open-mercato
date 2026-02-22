import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';

export type IntegrationRole = 'admin' | 'employee' | 'superadmin';

export type ComposeMessagePayload = {
  recipients: Array<{ userId: string; type?: 'to' | 'cc' | 'bcc' }>;
  subject: string;
  body: string;
  sendViaEmail?: boolean;
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
  const recipientInput = root.getByPlaceholder('Search recipients...');
  await recipientInput.click();
  await recipientInput.fill(email);

  const suggestion = root.getByRole('button', { name: new RegExp(`^${email}$`, 'i') }).first();
  await expect(suggestion).toBeVisible({ timeout: 10_000 });
  await suggestion.click();
  await expect(root.getByRole('button', { name: new RegExp(`^${email}$`, 'i') })).toHaveCount(0);
}

export async function searchMessages(page: Page, searchValue: string): Promise<void> {
  const input = page.getByPlaceholder('Search messages');
  await input.fill(searchValue);
  await page.waitForTimeout(1200);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function messageRowBySubject(page: Page, subject: string): Locator {
  return page.getByRole('row', { name: new RegExp(escapeRegex(subject), 'i') }).first();
}

export async function selectMessageFolder(page: Page, folderLabel: 'Inbox' | 'Sent' | 'Drafts' | 'Archived' | 'All'): Promise<void> {
  await page.getByRole('button', { name: /Folder:/i }).click();
  await page.getByRole('menuitemradio', { name: new RegExp(`^${escapeRegex(folderLabel)}$`, 'i') }).click();
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
