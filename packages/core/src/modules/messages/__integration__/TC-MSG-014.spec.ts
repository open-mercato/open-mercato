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
}): string {
  const params = new URLSearchParams();
  params.set('folder', options.folder);
  params.set('search', options.search);
  params.set('pageSize', '100');
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
 * TC-MSG-014: Inbox Bulk Archive And Delete
 * Source: .ai/specs/2026-04-23-messages-inbox-bulk-actions.md
 */
test.describe('TC-MSG-014: Inbox Bulk Archive And Delete', () => {
  test('should report partial archive success and confirm bulk delete', async ({ page, request }) => {
    const messageIds: string[] = [];
    let senderToken: string | null = null;
    let adminToken: string | null = null;

    const timestamp = Date.now();
    const archivePrefix = `QA TC-MSG-014 archive ${timestamp}`;
    const deletePrefix = `QA TC-MSG-014 delete ${timestamp}`;

    try {
      const archiveFirst = await composeInternalMessage(request, {
        subject: `${archivePrefix} alpha`,
        senderRole: 'employee',
        recipientRole: 'admin',
      });
      const archiveSecond = await composeInternalMessage(request, {
        subject: `${archivePrefix} beta`,
        senderRole: 'employee',
        recipientRole: 'admin',
      });

      messageIds.push(archiveFirst.messageId, archiveSecond.messageId);
      senderToken = archiveFirst.senderToken;
      adminToken = archiveFirst.recipientToken;

      await login(page, 'admin');
      await page.goto('/backend/messages');
      await searchMessages(page, archivePrefix);
      await expect(messageRowBySubject(page, `${archivePrefix} alpha`)).toBeVisible();
      await expect(messageRowBySubject(page, `${archivePrefix} beta`)).toBeVisible();

      const failingArchivePattern = new RegExp(`/api/messages/${archiveSecond.messageId}/archive(?:\\?|$)`, 'i');
      await page.route(failingArchivePattern, async (route) => {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Forced archive failure' }),
        });
      });

      await selectMessageRowsBySubject(page, [`${archivePrefix} alpha`, `${archivePrefix} beta`]);
      await expect(page.getByText('2 selected')).toBeVisible();
      await page.getByRole('button', { name: /^Archive$/i }).click();
      await expect(page.getByText('1 of 2 messages processed; 1 failed.')).toBeVisible();
      await expect(page.getByText('2 selected')).toHaveCount(0);

      await expect.poll(async () => {
        const archived = await readMessageList(
          request,
          adminToken!,
          buildMessageListPath({ folder: 'archived', search: archivePrefix }),
        );
        return archived.items?.length ?? 0;
      }).toBe(1);

      await expect.poll(async () => {
        const inbox = await readMessageList(
          request,
          adminToken!,
          buildMessageListPath({ folder: 'inbox', search: archivePrefix }),
        );
        return inbox.items?.length ?? 0;
      }).toBe(1);

      await page.unroute(failingArchivePattern);

      const deleteFirst = await composeInternalMessage(request, {
        subject: `${deletePrefix} alpha`,
        senderRole: 'employee',
        recipientRole: 'admin',
      });
      const deleteSecond = await composeInternalMessage(request, {
        subject: `${deletePrefix} beta`,
        senderRole: 'employee',
        recipientRole: 'admin',
      });

      messageIds.push(deleteFirst.messageId, deleteSecond.messageId);

      await searchMessages(page, deletePrefix);
      await expect(messageRowBySubject(page, `${deletePrefix} alpha`)).toBeVisible();
      await expect(messageRowBySubject(page, `${deletePrefix} beta`)).toBeVisible();

      await selectMessageRowsBySubject(page, [`${deletePrefix} alpha`, `${deletePrefix} beta`]);
      await expect(page.getByText('2 selected')).toBeVisible();
      await page.getByRole('button', { name: /^Delete$/i }).click();

      const deleteDialog = page.getByRole('alertdialog');
      await expect(deleteDialog.getByText('Delete 2 messages?')).toBeVisible();
      await deleteDialog.getByRole('button', { name: /^Delete$/i }).click();
      await expect(page.getByText('2 messages deleted.')).toBeVisible();

      await expect.poll(async () => {
        const inbox = await readMessageList(
          request,
          adminToken!,
          buildMessageListPath({ folder: 'inbox', search: deletePrefix }),
        );
        return inbox.items?.length ?? 0;
      }).toBe(0);
    } finally {
      await cleanupMessageCopies(request, messageIds, [adminToken, senderToken]);
    }
  });
});
