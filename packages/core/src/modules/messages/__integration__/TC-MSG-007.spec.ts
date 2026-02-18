import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { composeInternalMessage, deleteMessageIfExists, searchMessages } from './helpers';

/**
 * TC-MSG-007: Search And Filter Inbox
 * Source: .ai/qa/scenarios/TC-MSG-007-search-and-filter-inbox.md
 */
test.describe('TC-MSG-007: Search And Filter Inbox', () => {
  test('should narrow messages with search and hasActions filter', async ({ page, request }) => {
    let actionMessageId: string | null = null;
    let plainMessageId: string | null = null;
    let adminToken: string | null = null;

    const prefix = `QA TC-MSG-007 ${Date.now()}`;
    const actionSubject = `${prefix} actionable`;
    const plainSubject = `${prefix} plain`;

    try {
      const actionable = await composeInternalMessage(request, {
        subject: actionSubject,
        recipientRole: 'superadmin',
        actionData: {
          actions: [
            { id: 'ack', label: 'Acknowledge', href: '/backend/messages', isTerminal: true },
          ],
        },
      });
      actionMessageId = actionable.messageId;
      adminToken = actionable.senderToken;

      const plain = await composeInternalMessage(request, {
        subject: plainSubject,
        recipientRole: 'superadmin',
      });
      plainMessageId = plain.messageId;

      await login(page, 'superadmin');
      await page.goto('/backend/messages');

      await searchMessages(page, prefix);
      await expect(page.getByRole('row', { name: new RegExp(actionSubject, 'i') }).first()).toBeVisible();
      await expect(page.getByRole('row', { name: new RegExp(plainSubject, 'i') }).first()).toBeVisible();

      await page.getByRole('button', { name: /^Filters(?:\s+\d+)?$/i }).first().click();
      const overlay = page.locator('div.fixed.inset-0').last();
      await expect(overlay).toBeVisible();

      await overlay.getByRole('combobox').nth(4).selectOption('true');
      await overlay.getByRole('button', { name: 'Apply' }).first().click();

      await expect(page.getByRole('row', { name: new RegExp(actionSubject, 'i') }).first()).toBeVisible();
      await expect(page.getByRole('row', { name: new RegExp(plainSubject, 'i') })).toHaveCount(0);
    } finally {
      await deleteMessageIfExists(request, adminToken, actionMessageId);
      await deleteMessageIfExists(request, adminToken, plainMessageId);
    }
  });
});
