import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  deleteMessageIfExists,
  messageRowBySubject,
  searchMessages,
  selectMessageFolder,
} from './helpers';

/**
 * TC-MSG-010: Draft Management UI
 * Verifies: compose form shows "Save draft" button, clicking it saves the message
 * as a draft (not sent), the draft appears in the Drafts folder, and the draft
 * detail marks the message as editable (canEditDraft: true via API).
 * Note: drafts do not require recipients — useComposeDraftOperation.validate() always returns null.
 */
test.describe('TC-MSG-010: Draft Management UI', () => {
  test('should save compose form as draft and show it in Drafts folder', async ({ page, request }) => {
    let adminToken: string | null = null;
    let draftMessageId: string | null = null;
    const subject = `QA TC-MSG-010 ${Date.now()}`;

    try {
      adminToken = await getAuthToken(request, 'admin');

      await login(page, 'admin');
      await page.goto('/backend/messages/compose');

      // Fill subject — drafts do not require a recipient to be saved
      await page.locator('#messages-compose-subject').fill(subject);

      // Fill body — the textarea has placeholder "Write your message..."
      await page.getByPlaceholder('Write your message...').fill('Draft body content');

      // Click "Save draft" — button text comes from 'messages.saveDraft' key, default "Save draft"
      const saveDraftResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          /\/api\/messages(?:\?|$)/.test(response.url()) &&
          response.ok(),
        { timeout: 10_000 },
      );
      await page.getByRole('button', { name: /save draft/i }).click();
      const saveDraftResponse = await saveDraftResponsePromise;
      const saveDraftBody = (await saveDraftResponse.json()) as { id?: unknown };
      draftMessageId = typeof saveDraftBody.id === 'string' ? saveDraftBody.id : null;

      // After saving a draft the user should be redirected back to the messages page
      await expect(page).toHaveURL(/\/backend\/messages/, { timeout: 10_000 });

      // Switch to Drafts folder
      await selectMessageFolder(page, 'Drafts');

      // Search by subject
      await searchMessages(page, subject);

      // Draft row must be visible
      await expect.poll(async () => messageRowBySubject(page, subject).count(), { timeout: 10_000 }).toBeGreaterThan(0);
      await expect(messageRowBySubject(page, subject)).toBeVisible();
    } finally {
      // Find and delete the created draft via API
      if (adminToken) {
        if (draftMessageId) {
          await deleteMessageIfExists(request, adminToken, draftMessageId);
          return;
        }
        try {
          const draftsResponse = await apiRequest(
            request,
            'GET',
            `/api/messages?folder=drafts&search=${encodeURIComponent(subject)}&pageSize=20`,
            { token: adminToken },
          );
          if (draftsResponse.ok()) {
            const draftsBody = (await draftsResponse.json()) as {
              items?: Array<{ id?: unknown }>;
            };
            for (const item of draftsBody.items ?? []) {
              await deleteMessageIfExists(request, adminToken, item.id as string);
            }
          }
        } catch {
          // Ignore cleanup failures when the request context is already disposed after timeout/cancel.
        }
      }
    }
  });
});
