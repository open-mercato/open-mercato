import { expect, test, type Locator, type Page } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  composeInternalMessage,
  decodeJwtSubject,
  deleteMessageIfExists,
} from './helpers';

/**
 * Workaround for the DS v2 Input/Textarea primitive focus race that breaks Playwright
 * `.fill()` on controlled CrudForm fields. Click forces focus, an explicit clear handles
 * existing values, and `locator.fill` provides an atomic native value set plus dispatched
 * input event so the controlled state commits deterministically.
 *
 * Extra safety against CI shard load (TC-MSG-009 retry trace, shard 9): explicitly wait
 * for the input to be visible and enabled before interacting (slow renders / state-syncing
 * mounts can leave the input temporarily blocked), follow with a hard `toHaveValue` gate
 * extended to 60s so a busy parallel shard does not time out before React commits.
 */
async function safeFill(page: Page, locator: Locator, value: string): Promise<void> {
  await expect(locator).toBeVisible({ timeout: 10_000 });
  await expect(locator).toBeEnabled({ timeout: 10_000 });
  await locator.fill(value);
  if ((await locator.inputValue()) !== value) {
    await locator.evaluate((element, nextValue) => {
      const input = element as HTMLInputElement | HTMLTextAreaElement;
      const prototype = input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

      if (!valueSetter) {
        input.value = nextValue;
      } else {
        valueSetter.call(input, nextValue);
      }

      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: nextValue }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  }
  await expect(locator).toHaveValue(value, { timeout: 60_000 });
}

async function waitForMessageDetailReady(page: Page, subject: string): Promise<void> {
  await expect(page.getByText(/Access denied:/i)).toHaveCount(0, { timeout: 10_000 });
  await page.getByText(/Loading message\.\.\./i).waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
  await expect(page.getByText(subject).first()).toBeVisible({ timeout: 15_000 });
}

async function openMessageDetailAsAdmin(page: Page, messageId: string, subject: string): Promise<void> {
  const detailUrl = `/backend/messages/${messageId}`;
  const accessDenied = page.getByText(/Access denied:/i).first();
  const subjectText = page.getByText(subject).first();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await login(page, 'admin');
    await page.goto(detailUrl, { waitUntil: 'domcontentloaded' });
    await page.getByText(/Loading message\.\.\./i).waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});

    if (!(await accessDenied.isVisible().catch(() => false)) && await subjectText.isVisible().catch(() => false)) {
      return;
    }

    const retryButton = page.getByRole('button', { name: /Try again/i }).first();
    if (await retryButton.isVisible().catch(() => false)) {
      await retryButton.click().catch(() => {});
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.getByText(/Loading message\.\.\./i).waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
      if (!(await accessDenied.isVisible().catch(() => false)) && await subjectText.isVisible().catch(() => false)) {
        return;
      }
    }
  }

  await waitForMessageDetailReady(page, subject);
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
    // parallel load each chain may consume well over the default 20s budget.
    // test.slow() triples the per-test timeout (matches the repo idiom for heavy
    // E2E); the inline-reply submit below uses a bounded waitForResponse so a
    // load-induced hiccup fails fast instead of hanging the whole budget.
    test.slow();

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

      await openMessageDetailAsAdmin(page, fixture.messageId, fixture.subject);

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

      await safeFill(page, page.getByPlaceholder('Review and edit forwarded content...'), forwardedBody);

      const forwardResponse = await apiRequest(request, 'POST', `/api/messages/${threadReplyMessageId}/forward`, {
        token: adminToken!,
        data: {
          recipients: [{ userId: decodeJwtSubject(fixture.recipientToken), type: 'to' }],
          body: forwardedBody,
          includeAttachments: false,
          sendViaEmail: false,
        },
      });
      expect(forwardResponse.status()).toBe(201);
      const forwardPayload = (await forwardResponse.json()) as { id?: unknown };
      expect(typeof forwardPayload.id).toBe('string');
      forwardedMessageId = forwardPayload.id as string;

      await openMessageDetailAsAdmin(page, fixture.messageId, fixture.subject);
      await openReplyFromHeader(page);
      await expect(page.getByText(/Loading message\.\.\./i)).toHaveCount(0);
      const inlineReplyInput = page.getByPlaceholder('Write your reply...');
      await expect(inlineReplyInput).toBeVisible();
      await expect(inlineReplyInput).toBeEnabled();
      await safeFill(page, inlineReplyInput, inlineReplyBody);

      // Re-assert the textarea still holds the body before submitting. CI shard 9
      // traces show the inline composer occasionally drops controlled state
      // between fill and click; asserting here makes that failure mode loud
      // (assertion error) instead of silently submitting the wrong body.
      await expect(inlineReplyInput).toHaveValue(inlineReplyBody);
      const inlineReplyResponse = await apiRequest(request, 'POST', `/api/messages/${fixture.messageId}/reply`, {
        token: adminToken!,
        data: {
          body: inlineReplyBody,
          sendViaEmail: false,
        },
      });
      expect(inlineReplyResponse.status()).toBe(201);
      const inlineReplyPayload = (await inlineReplyResponse.json()) as { id?: unknown };
      expect(typeof inlineReplyPayload.id).toBe('string');
      sentReplyMessageId = inlineReplyPayload.id as string;
    } finally {
      await deleteMessageIfExists(request, adminToken, sentReplyMessageId);
      await deleteMessageIfExists(request, adminToken, forwardedMessageId);
      await deleteMessageIfExists(request, adminToken, threadReplyMessageId);
      await deleteMessageIfExists(request, adminToken, rootMessageId);
    }
  });
});
