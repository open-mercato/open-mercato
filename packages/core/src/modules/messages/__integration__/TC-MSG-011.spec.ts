import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  deleteMessageIfExists,
  messageRowBySubject,
  searchMessages,
  selectMessageFolder,
  selectRecipientFromComposer,
} from './helpers';

/**
 * TC-MSG-011: Priority Selector in Compose Form
 * Verifies: the priority radiogroup is rendered in the compose form, selecting
 * "High" marks the correct radio as checked (aria-checked="true"), and the sent
 * message is persisted with priority 'high' (confirmed via API detail fetch).
 */
test.describe('TC-MSG-011: Priority Selector in Compose Form', () => {
  test('should apply high priority selection and persist it on the sent message', async ({ page, request }) => {
    let adminToken: string | null = null;
    let messageId: string | null = null;
    const subject = `QA TC-MSG-011 ${Date.now()}`;

    try {
      adminToken = await getAuthToken(request, 'admin');

      await login(page, 'admin');
      await page.goto('/backend/messages/compose');

      // Select recipient
      await selectRecipientFromComposer(page, 'employee@acme.com');

      // Fill subject
      await page.locator('#messages-compose-subject').fill(subject);

      // Fill body
      await page.getByPlaceholder('Write your message...').fill('Priority selector test body');

      // The priority selector is a radiogroup with aria-label "Priority".
      // Each option is a button with role="radio" and aria-label set to the priority label.
      const priorityGroup = page.getByRole('radiogroup', { name: /priority/i });
      await expect(priorityGroup).toBeVisible();

      // "Normal" should be selected by default
      const normalOption = priorityGroup.getByRole('radio', { name: /normal/i });
      await expect(normalOption).toHaveAttribute('aria-checked', 'true');

      // Click "High"
      const highOption = priorityGroup.getByRole('radio', { name: /high/i });
      await highOption.click();
      await expect(highOption).toHaveAttribute('aria-checked', 'true');
      await expect(normalOption).toHaveAttribute('aria-checked', 'false');

      // Submit the message — the CrudForm submit button text is the send label (e.g. "Send")
      // The form has a submit button in the FormFooter area
      await page.getByRole('button', { name: /^send$/i }).click();

      // After sending, user is redirected to messages list
      await expect(page).toHaveURL(/\/backend\/messages/, { timeout: 10_000 });

      // Navigate to Sent folder and find the message
      await selectMessageFolder(page, 'Sent');
      await searchMessages(page, subject);
      await expect(messageRowBySubject(page, subject)).toBeVisible();

      // Extract the message ID from the API to verify priority in detail
      const sentListResponse = await apiRequest(
        request,
        'GET',
        `/api/messages?folder=sent&search=${encodeURIComponent(subject)}&pageSize=20`,
        { token: adminToken },
      );
      expect(sentListResponse.ok()).toBeTruthy();
      const sentListBody = (await sentListResponse.json()) as {
        items?: Array<{ id?: unknown; priority?: unknown }>;
      };
      const sentItem = sentListBody.items?.find((item) => {
        const subject_ = (item as Record<string, unknown>).subject;
        return typeof subject_ === 'string' && subject_.includes(subject);
      }) ?? sentListBody.items?.[0];
      expect(sentItem).toBeTruthy();
      expect(sentItem?.priority).toBe('high');
      messageId = sentItem?.id as string;
    } finally {
      await deleteMessageIfExists(request, adminToken, messageId);
    }
  });
});
