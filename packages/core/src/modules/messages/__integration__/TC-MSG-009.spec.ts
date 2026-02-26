import { expect, test, type Page } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  composeInternalMessage,
  deleteMessageIfExists,
  selectRecipientFromComposer,
} from './helpers';

async function openForwardAllFromHeader(page: Page): Promise<void> {
  // The ActionsDropdown opens via onMouseEnter (hover), not click.
  // Clicking toggles closed if already hovered-open, so we hover to open the menu.
  await page.getByRole('button', { name: /Conversation actions|messages\.actions\.conversationActions/i }).hover();
  await page.getByRole('menuitem', { name: /Forward all|messages\.actions\.forwardAll/i }).first().click();
}

async function openReplyFromHeader(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Conversation actions|messages\.actions\.conversationActions/i }).hover();
  await page.getByRole('menuitem', { name: /Reply|messages\.reply/i }).first().click();
}

/**
 * TC-MSG-009: Message Detail Inline Reply And Forward Composer
 * Source: .ai/specs/SPEC-038-2026-02-24-message-detail-inline-composer.md
 */
test.describe('TC-MSG-009: Message Detail Inline Reply And Forward Composer', () => {
  test('should compose inline below conversation, switch modes, close with escape, and submit forward/reply', async ({ page, request }) => {
    let rootMessageId: string | null = null;
    let threadReplyMessageId: string | null = null;
    let forwardedMessageId: string | null = null;
    let sentReplyMessageId: string | null = null;
    let adminToken: string | null = null;

    const timestamp = Date.now();
    const threadReplyBody = `Thread reply body ${timestamp}`;
    const forwardedBody = `Forwarded inline body ${timestamp}`;
    const inlineReplyBody = `Inline reply body ${timestamp}`;

    try {
      const fixture = await composeInternalMessage(request, {
        subject: `QA TC-MSG-009 ${timestamp}`,
      });
      rootMessageId = fixture.messageId;
      adminToken = fixture.senderToken;

      const replyResponse = await apiRequest(request, 'POST', `/api/messages/${fixture.messageId}/reply`, {
        token: fixture.recipientToken,
        data: {
          body: threadReplyBody,
          sendViaEmail: false,
        },
      });
      expect(replyResponse.status()).toBe(201);
      const replyPayload = (await replyResponse.json()) as { id?: unknown };
      expect(typeof replyPayload.id).toBe('string');
      threadReplyMessageId = replyPayload.id as string;

      await login(page, 'admin');
      await page.goto(`/backend/messages/${fixture.messageId}`);

      await openReplyFromHeader(page);
      await expect(page.getByPlaceholder('Write your reply...')).toBeVisible();
      await expect(page.getByRole('dialog', { name: /^Reply$/i })).toHaveCount(0);
      await expect(page.getByText(threadReplyBody)).toBeVisible();

      const firstForwardPreviewPromise = page.waitForResponse((response) => (
        response.request().method() === 'GET'
        && response.url().includes(`/api/messages/${threadReplyMessageId}/forward-preview`)
      ));
      await openForwardAllFromHeader(page);
      const firstForwardPreview = await firstForwardPreviewPromise;
      expect(firstForwardPreview.ok()).toBeTruthy();

      await expect(page.getByPlaceholder('Write your reply...')).toHaveCount(0);
      await expect(page.getByPlaceholder('Review and edit forwarded content...')).toBeVisible();

      await page.keyboard.press('Escape');
      await expect(page.getByPlaceholder('Review and edit forwarded content...')).toHaveCount(0);
      await expect(page).toHaveURL(new RegExp(`/backend/messages/${fixture.messageId}$`, 'i'));

      const secondForwardPreviewPromise = page.waitForResponse((response) => (
        response.request().method() === 'GET'
        && response.url().includes(`/api/messages/${threadReplyMessageId}/forward-preview`)
      ));
      await openForwardAllFromHeader(page);
      const secondForwardPreview = await secondForwardPreviewPromise;
      expect(secondForwardPreview.ok()).toBeTruthy();

      await selectRecipientFromComposer(page, 'employee@acme.com');
      await page.getByPlaceholder('Review and edit forwarded content...').fill(forwardedBody);

      const forwardResponsePromise = page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && response.url().includes(`/api/messages/${threadReplyMessageId}/forward`)
      ));
      await page.getByRole('button', { name: /^Forward$/i }).first().click();
      const forwardResponse = await forwardResponsePromise;
      expect(forwardResponse.ok()).toBeTruthy();
      const forwardPayload = (await forwardResponse.json()) as { id?: unknown };
      expect(typeof forwardPayload.id).toBe('string');
      forwardedMessageId = forwardPayload.id as string;
      // Inline composer calls onSuccess → setActiveInlineComposer(null) + refetch; it does NOT navigate.
      await expect(page.getByText('Message forwarded.').first()).toBeVisible();

      await page.goto(`/backend/messages/${fixture.messageId}`);
      await openReplyFromHeader(page);
      await expect(page.getByPlaceholder('Write your reply...')).toBeVisible();
      await page.getByPlaceholder('Write your reply...').fill(inlineReplyBody);

      const inlineReplyResponsePromise = page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && response.url().includes(`/api/messages/${fixture.messageId}/reply`)
      ));
      await page.getByPlaceholder('Write your reply...').press('Control+Enter');
      const inlineReplyResponse = await inlineReplyResponsePromise;
      expect(inlineReplyResponse.ok()).toBeTruthy();
      const inlineReplyPayload = (await inlineReplyResponse.json()) as { id?: unknown };
      expect(typeof inlineReplyPayload.id).toBe('string');
      sentReplyMessageId = inlineReplyPayload.id as string;
      // Inline reply also stays on the current URL; verify via flash message.
      await expect(page.getByText('Reply sent.').first()).toBeVisible();
    } finally {
      await deleteMessageIfExists(request, adminToken, sentReplyMessageId);
      await deleteMessageIfExists(request, adminToken, forwardedMessageId);
      await deleteMessageIfExists(request, adminToken, threadReplyMessageId);
      await deleteMessageIfExists(request, adminToken, rootMessageId);
    }
  });
});
