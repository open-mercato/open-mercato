import { expect, test, type Locator, type Page } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  composeInternalMessage,
  deleteMessageIfExists,
  selectRecipientFromComposer,
} from './helpers';

/**
 * Workaround for the DS v2 Input/Textarea primitive focus race that breaks Playwright
 * `.fill()` on controlled CrudForm fields. Click forces focus, an explicit clear handles
 * existing values, and `keyboard.type` walks key events through the focus pipeline.
 *
 * Extra safety against CI shard load: explicitly wait for the input to be visible and
 * enabled before interacting (slow renders / state-syncing mounts can leave the input
 * temporarily blocked), and extend the value-assert timeout to 60s so a busy parallel
 * shard does not time out before React commits.
 */
async function safeFill(page: Page, locator: Locator, value: string): Promise<void> {
  await expect(locator).toBeVisible({ timeout: 10_000 });
  await expect(locator).toBeEnabled({ timeout: 10_000 });
  // CI shard 9 (TC-MSG-009 retry trace): keyboard.type races React state commit
  // when the inline composer mounts and applies effects in parallel, so the
  // typed value sometimes lands and is then dropped before submit. Use
  // locator.fill — atomic native value set + dispatched input event —
  // followed by a hard toHaveValue gate to ensure the controlled state has
  // committed before the caller proceeds to click submit.
  await locator.fill(value);
  await expect(locator).toHaveValue(value, { timeout: 60_000 });
}

async function waitForMessageDetailReady(page: Page, subject: string): Promise<void> {
  await expect(page.getByText(/Loading message\.\.\./i)).toHaveCount(0);
  await expect(page.getByText(subject).first()).toBeVisible();
}

async function selectConversationAction(page: Page, name: RegExp): Promise<void> {
  // The ActionsDropdown opens via onMouseEnter (hover), not click.
  // Clicking toggles closed if already hovered-open, so we hover to open the menu.
  await page.getByRole('button', { name: /Conversation actions|messages\.actions\.conversationActions/i }).hover();
  const menuItem = page.getByRole('menuitem', { name }).first();
  await expect(menuItem).toBeVisible();
  await menuItem.click({ force: true });
}

async function openForwardAllFromHeader(page: Page): Promise<void> {
  await selectConversationAction(page, /Forward all|messages\.actions\.forwardAll/i);
}

async function openReplyFromHeader(page: Page): Promise<void> {
  await selectConversationAction(page, /Reply|messages\.reply/i);
}

/**
 * TC-MSG-009: Message Detail Inline Reply And Forward Composer
 * Source: .ai/specs/SPEC-038-2026-02-24-message-detail-inline-composer.md
 */
test.describe('TC-MSG-009: Message Detail Inline Reply And Forward Composer', () => {
  test('should compose inline below conversation, switch modes, close with escape, and submit forward/reply', async ({ page, request }) => {
    // Multiple safeFill chains plus waitForResponse on submit; under CI shard 9
    // parallel load each chain may consume ~10–80s of the default 20s budget.
    test.setTimeout(180_000);

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
      await waitForMessageDetailReady(page, fixture.subject);

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
      await safeFill(page, page.getByPlaceholder('Review and edit forwarded content...'), forwardedBody);

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
      await waitForMessageDetailReady(page, fixture.subject);
      await openReplyFromHeader(page);
      await expect(page.getByText(/Loading message\.\.\./i)).toHaveCount(0);
      const inlineReplyInput = page.getByPlaceholder('Write your reply...');
      await expect(inlineReplyInput).toBeVisible();
      await expect(inlineReplyInput).toBeEnabled();
      await safeFill(page, inlineReplyInput, inlineReplyBody);

      const inlineReplyResponsePromise = page.waitForResponse((response) => {
        if (response.request().method() !== 'POST') return false;
        let pathname = '';
        try {
          pathname = new URL(response.url()).pathname;
        } catch {
          return false;
        }
        if (!/^\/api\/messages\/[^/]+\/reply$/i.test(pathname)) return false;
        const requestBody = response.request().postData() ?? '';
        return requestBody.includes(inlineReplyBody);
      });
      // Click the composer submit button instead of pressing Ctrl+Enter — the
      // SwitchableMarkdownInput textarea (text mode) has no keyboard submit
      // handler, so Ctrl+Enter just inserts a newline. The composer header
      // renders a "Reply" submit button via FormHeader; .last() picks it
      // (the dropdown menu item is gone after openReplyFromHeader).
      // Re-assert the textarea still holds the body. CI shard 9 trace shows
      // the inline composer occasionally drops controlled state between fill
      // and click — refilling here makes the failure mode loud (assertion
      // error pointing at the resync) instead of a silent empty-body POST.
      await expect(inlineReplyInput).toHaveValue(inlineReplyBody);
      await page.getByRole('button', { name: /^Reply$/i }).last().click();
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
