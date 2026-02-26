import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { composeInternalMessage, deleteMessageIfExists, messageRowBySubject, searchMessages } from './helpers';

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
        recipientRole: 'admin',
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
        recipientRole: 'admin',
      });
      plainMessageId = plain.messageId;

      await login(page, 'admin');
      await page.goto('/backend/messages');

      await searchMessages(page, prefix);
      await expect(messageRowBySubject(page, actionSubject)).toBeVisible();
      await expect(messageRowBySubject(page, plainSubject)).toBeVisible();

      await page.getByRole('button', { name: /^Filters(?:\s+\d+)?$/i }).first().click();
      const overlay = page.locator('div.fixed.inset-0').last();
      await expect(overlay).toBeVisible();

      const actionsFilterBlock = overlay.locator('div.space-y-2').filter({ hasText: /Actions/i }).first();
      await actionsFilterBlock.locator('select').first().selectOption('true');
      await overlay.getByRole('button', { name: 'Apply' }).first().click();

      await expect(messageRowBySubject(page, actionSubject)).toBeVisible();
      await expect(page.getByRole('row', { name: new RegExp(plainSubject, 'i') })).toHaveCount(0);
    } finally {
      await deleteMessageIfExists(request, adminToken, actionMessageId);
      await deleteMessageIfExists(request, adminToken, plainMessageId);
    }
  });
});
