import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { composeInternalMessage, deleteMessageIfExists, messageRowBySubject, searchMessages, selectMessageFolder } from './helpers';

/**
 * TC-MSG-005: Archive And Unarchive Message
 * Source: .ai/qa/scenarios/TC-MSG-005-archive-and-unarchive-message.md
 */
test.describe('TC-MSG-005: Archive And Unarchive Message', () => {
  test('should archive message into archived folder and unarchive it back', async ({ page, request }) => {
    let messageId: string | null = null;
    let adminToken: string | null = null;

    try {
      const fixture = await composeInternalMessage(request, {
        subject: `QA TC-MSG-005 ${Date.now()}`,
        recipientRole: 'admin',
      });
      messageId = fixture.messageId;
      adminToken = fixture.senderToken;

      await login(page, 'admin');
      await page.goto(`/backend/messages/${fixture.messageId}`);

      const actionsButton = page.getByRole('button', { name: /^Actions$|ui\.actions\.actions/i });
      const clickActionMenuItem = async (actionName: RegExp): Promise<void> => {
        for (let attempt = 0; attempt < 4; attempt += 1) {
          await actionsButton.hover();
          const menuItem = page.getByRole('menuitem', { name: actionName }).first();
          if (await menuItem.isVisible().catch(() => false)) {
            await menuItem.click();
            return;
          }
          await actionsButton.click();
          if (await menuItem.isVisible().catch(() => false)) {
            await menuItem.click();
            return;
          }
          await page.waitForTimeout(250);
        }
        await expect(page.getByRole('menuitem', { name: actionName }).first()).toBeVisible();
        await page.getByRole('menuitem', { name: actionName }).first().click();
      };

      const archiveResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === 'PUT' &&
          /\/api\/messages\/[^/]+\/archive(?:\?|$)/.test(response.url()) &&
          response.ok(),
        { timeout: 10_000 },
      );
      await clickActionMenuItem(/^Archive$|messages\.actions\.archive/i);
      await archiveResponsePromise;

      // After archiving the menu label switches to "Unarchive".
      await expect.poll(async () => {
        await actionsButton.hover();
        return page.getByRole('menuitem', { name: /Unarchive|messages\.actions\.unarchive/i }).count();
      }, { timeout: 8_000 }).toBeGreaterThan(0);

      await page.goto('/backend/messages');
      await selectMessageFolder(page, 'Archived');
      await searchMessages(page, fixture.subject);
      await expect(messageRowBySubject(page, fixture.subject)).toBeVisible();

      await messageRowBySubject(page, fixture.subject).click();

      const unarchiveResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === 'DELETE' &&
          /\/api\/messages\/[^/]+\/archive(?:\?|$)/.test(response.url()) &&
          response.ok(),
        { timeout: 10_000 },
      );
      await clickActionMenuItem(/Unarchive|messages\.actions\.unarchive/i);
      await unarchiveResponsePromise;

      // After unarchiving the menu label switches back to "Archive".
      await expect.poll(async () => {
        await actionsButton.hover();
        return page.getByRole('menuitem', { name: /^Archive$|messages\.actions\.archive/i }).count();
      }, { timeout: 8_000 }).toBeGreaterThan(0);

      await page.goto('/backend/messages');
      await selectMessageFolder(page, 'Inbox');
      await searchMessages(page, fixture.subject);
      await expect(messageRowBySubject(page, fixture.subject)).toBeVisible();
    } finally {
      await deleteMessageIfExists(request, adminToken, messageId);
    }
  });
});
