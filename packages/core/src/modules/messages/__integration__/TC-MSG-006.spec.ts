import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { composeInternalMessage, deleteMessageIfExists } from './helpers';

/**
 * TC-MSG-006: Execute Message Action And Lock State
 * Source: .ai/qa/scenarios/TC-MSG-006-execute-message-action-and-lock-state.md
 */
test.describe('TC-MSG-006: Execute Message Action And Lock State', () => {
  test('should execute action and disable action buttons after terminal state', async ({ page, request }) => {
    test.slow();
    test.setTimeout(120_000);

    let messageId: string | null = null;
    let adminToken: string | null = null;

    try {
      const fixture = await composeInternalMessage(request, {
        subject: `QA TC-MSG-006 ${Date.now()}`,
        recipientRole: 'admin',
        actionData: {
          actions: [
            { id: 'approve', label: 'Approve', href: '/backend/messages', isTerminal: true },
            { id: 'reject', label: 'Reject', href: '/backend/messages', isTerminal: true },
          ],
        },
      });
      messageId = fixture.messageId;
      adminToken = fixture.senderToken;

      await login(page, 'admin');
      await page.goto(`/backend/messages/${fixture.messageId}`, { waitUntil: 'domcontentloaded' });

      await expect(page.getByRole('heading', { name: 'Actions' })).toBeVisible();
      const actionResponsePromise = page.waitForResponse((response) => {
        return response.request().method() === 'POST'
          && new URL(response.url()).pathname === `/api/messages/${fixture.messageId}/actions/approve`;
      });
      const actionNavigationPromise = page
        .waitForURL(/\/backend\/messages(?:\?.*)?$/, { waitUntil: 'domcontentloaded' })
        .catch(() => undefined);

      await page.getByRole('button', { name: 'Approve' }).click();
      const actionResponse = await actionResponsePromise;
      expect(actionResponse.status(), 'approve action request succeeds').toBe(200);
      await actionNavigationPromise;

      await page.goto(`/backend/messages/${fixture.messageId}`, { waitUntil: 'domcontentloaded' });

      const actionTaken = page.getByText(/Action taken:/i).first();
      try {
        await expect(actionTaken).toBeVisible({ timeout: 10_000 });
      } catch {
        await expect(page.getByRole('button', { name: 'Approve' })).toBeDisabled();
        await expect(page.getByRole('button', { name: 'Reject' })).toBeDisabled();
      }
    } finally {
      await deleteMessageIfExists(request, adminToken, messageId);
    }
  });
});
