import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest } from '@open-mercato/core/helpers/integration/api';
import { login } from '@open-mercato/core/helpers/integration/auth';
import {
  composeInternalMessage,
  deleteMessageIfExists,
  messageRowBySubject,
  searchMessages,
  selectMessageRowsBySubject,
} from './helpers';

type MessageListResponse = {
  items?: Array<{ id?: unknown; status?: unknown; subject?: unknown }>;
};

function buildMessageListPath(options: {
  folder: 'inbox' | 'archived';
  search: string;
  status?: 'read' | 'unread';
}): string {
  const params = new URLSearchParams();
  params.set('folder', options.folder);
  params.set('search', options.search);
  params.set('pageSize', '100');
  if (options.status) {
    params.set('status', options.status);
  }
  return `/api/messages?${params.toString()}`;
}

async function readMessageList(
  request: APIRequestContext,
  token: string,
  path: string,
): Promise<MessageListResponse> {
  const response = await apiRequest(request, 'GET', path, { token });
  expect(response.status()).toBe(200);
  return (await response.json()) as MessageListResponse;
}

async function cleanupMessageCopies(
  request: APIRequestContext,
  messageIds: string[],
  tokens: Array<string | null>,
): Promise<void> {
  for (const messageId of messageIds) {
    for (const token of tokens) {
      await deleteMessageIfExists(request, token, messageId);
    }
  }
}

/**
 * TC-MSG-013: Inbox Bulk Mark Read And Mark Unread
 * Source: .ai/specs/2026-04-23-messages-inbox-bulk-actions.md
 */
test.describe('TC-MSG-013: Inbox Bulk Mark Read And Mark Unread', () => {
  test('should bulk mark inbox messages read and unread and keep selection on total failure', async ({ page, request }) => {
    const messageIds: string[] = [];
    let adminToken: string | null = null;
    let employeeToken: string | null = null;

    const prefix = `QA TC-MSG-013 ${Date.now()}`;

    try {
      const firstMessage = await composeInternalMessage(request, {
        subject: `${prefix} alpha`,
      });
      const secondMessage = await composeInternalMessage(request, {
        subject: `${prefix} beta`,
      });

      messageIds.push(firstMessage.messageId, secondMessage.messageId);
      adminToken = firstMessage.senderToken;
      employeeToken = firstMessage.recipientToken;

      await login(page, 'employee');
      await page.goto('/backend/messages');
      await searchMessages(page, prefix);
      await expect(messageRowBySubject(page, `${prefix} alpha`)).toBeVisible();
      await expect(messageRowBySubject(page, `${prefix} beta`)).toBeVisible();

      await selectMessageRowsBySubject(page, [`${prefix} alpha`, `${prefix} beta`]);
      await expect(page.getByText('2 selected')).toBeVisible();
      await page.getByRole('button', { name: /^Mark read$/i }).click();
      await expect(page.getByText('2 messages marked as read.')).toBeVisible();

      await expect.poll(async () => {
        const body = await readMessageList(
          request,
          employeeToken!,
          buildMessageListPath({ folder: 'inbox', search: prefix, status: 'read' }),
        );
        return body.items?.length ?? 0;
      }).toBe(2);

      await searchMessages(page, prefix);
      await selectMessageRowsBySubject(page, [`${prefix} alpha`, `${prefix} beta`]);
      await expect(page.getByText('2 selected')).toBeVisible();
      await page.getByRole('button', { name: /^Mark unread$/i }).click();
      await expect(page.getByText('2 messages marked as unread.')).toBeVisible();

      await expect.poll(async () => {
        const body = await readMessageList(
          request,
          employeeToken!,
          buildMessageListPath({ folder: 'inbox', search: prefix, status: 'unread' }),
        );
        return body.items?.length ?? 0;
      }).toBe(2);

      const forcedFailurePattern = /\/api\/messages\/[^/]+\/read(?:\?|$)/i;
      await page.route(forcedFailurePattern, async (route) => {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Forced failure' }),
        });
      });

      await searchMessages(page, prefix);
      await selectMessageRowsBySubject(page, [`${prefix} alpha`, `${prefix} beta`]);
      await expect(page.getByText('2 selected')).toBeVisible();
      await page.getByRole('button', { name: /^Mark read$/i }).click();
      await expect(page.getByText('Failed to process 2 messages.')).toBeVisible();
      await expect(page.getByText('2 selected')).toBeVisible();

      await page.unroute(forcedFailurePattern);
    } finally {
      await cleanupMessageCopies(request, messageIds, [employeeToken, adminToken]);
    }
  });
});
