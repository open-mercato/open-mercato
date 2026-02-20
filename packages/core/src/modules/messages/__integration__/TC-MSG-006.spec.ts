import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { composeInternalMessage, deleteMessageIfExists, searchMessages } from './helpers';

/**
 * TC-MSG-006: Execute Message Action And Lock State
 * Source: .ai/qa/scenarios/TC-MSG-006-execute-message-action-and-lock-state.md
 */
test.describe('TC-MSG-006: Execute Message Action And Lock State', () => {
  test('should execute action and disable action buttons after terminal state', async ({ page, request }) => {
    let messageId: string | null = null;
    let adminToken: string | null = null;

    try {
      const fixture = await composeInternalMessage(request, {
        subject: `QA TC-MSG-006 ${Date.now()}`,
        actionData: {
          actions: [
            { id: 'approve', label: 'Approve', href: '/backend/messages', isTerminal: true },
            { id: 'reject', label: 'Reject', href: '/backend/messages', isTerminal: true },
          ],
        },
      });
      messageId = fixture.messageId;
      adminToken = fixture.senderToken;

      await login(page, 'employee');
      await page.goto(`/backend/messages/${fixture.messageId}`);

      await expect(page.getByRole('heading', { name: 'Actions' })).toBeVisible();
      await page.getByRole('button', { name: 'Approve' }).click();

      await expect(page).toHaveURL(/\/backend\/messages$/i);
      await searchMessages(page, fixture.subject);
      await page.getByRole('row', { name: new RegExp(fixture.subject, 'i') }).first().click();

      const actionTaken = page.getByText(/Action taken:/i).first();
      try {
        await expect(actionTaken).toBeVisible({ timeout: 3_000 });
      } catch {
        await expect(page.getByRole('button', { name: 'Approve' })).toBeDisabled();
        await expect(page.getByRole('button', { name: 'Reject' })).toBeDisabled();
      }
    } finally {
      await deleteMessageIfExists(request, adminToken, messageId);
    }
  });
});
