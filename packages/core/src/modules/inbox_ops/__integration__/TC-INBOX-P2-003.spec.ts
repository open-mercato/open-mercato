import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import {
  submitTextExtraction,
  waitForEmailProcessed,
  deleteInboxEmail,
} from '@open-mercato/core/modules/core/__integration__/helpers/inboxFixtures';

/**
 * TC-INBOX-P2-003: Manual categorization via UI and API
 *
 * Verifies that a proposal's category can be changed via the
 * POST /api/inbox_ops/proposals/:id/categorize endpoint and that
 * the UI reflects the change.
 */
test.describe('TC-INBOX-P2-003: Manual Categorization', () => {
  let token: string;
  let proposalId: string | undefined;
  const createdEmailIds: string[] = [];

  test.beforeAll(async ({ request }) => {
    test.setTimeout(90000);
    token = await getAuthToken(request, 'admin');

    const result = await submitTextExtraction(request, token, {
      text: [
        'From: Pierre Dupont <pierre@dupont-sa.fr>',
        'Subject: Complaint about delayed shipment',
        '',
        'Dear Support,',
        'Our order ORD-2024-999 has not arrived yet.',
        'It was supposed to be delivered 2 weeks ago.',
        'Please investigate immediately.',
        '',
        'Pierre Dupont',
      ].join('\n'),
      title: 'TC-INBOX-P2-003 categorization fixture',
    });

    if (result.emailId) {
      createdEmailIds.push(result.emailId);
      const processed = await waitForEmailProcessed(request, token, result.emailId, 45000);
      proposalId = processed?.proposalId;
    }
  });

  test.afterAll(async ({ request }) => {
    for (const emailId of createdEmailIds) {
      await deleteInboxEmail(request, token, emailId);
    }
  });

  test('POST /api/inbox_ops/proposals/:id/categorize changes category', async ({ request }) => {
    if (!proposalId) {
      test.skip(true, 'No proposal was created during setup');
      return;
    }

    // Step 1: Get current category
    const detailResponse = await apiRequest(
      request, 'GET', `/api/inbox_ops/proposals/${proposalId}`, { token },
    );
    expect(detailResponse.status()).toBe(200);
    const detailBody = await readJsonSafe<{
      proposal: { id: string; category?: string | null };
    }>(detailResponse);
    const originalCategory = detailBody?.proposal?.category ?? null;

    // Step 2: Change category to a different one
    const newCategory = originalCategory === 'inquiry' ? 'complaint' : 'inquiry';
    const categorizeResponse = await apiRequest(
      request, 'POST', `/api/inbox_ops/proposals/${proposalId}/categorize`, {
        token,
        data: { category: newCategory },
      },
    );
    expect(categorizeResponse.status()).toBe(200);
    const categorizeBody = await readJsonSafe<{
      ok: boolean;
      category: string;
      previousCategory: string | null;
    }>(categorizeResponse);
    expect(categorizeBody?.ok).toBe(true);
    expect(categorizeBody?.category).toBe(newCategory);
    expect(categorizeBody?.previousCategory).toBe(originalCategory);

    // Step 3: Verify the category was persisted
    const verifyResponse = await apiRequest(
      request, 'GET', `/api/inbox_ops/proposals/${proposalId}`, { token },
    );
    expect(verifyResponse.status()).toBe(200);
    const verifyBody = await readJsonSafe<{
      proposal: { id: string; category?: string | null };
    }>(verifyResponse);
    expect(verifyBody?.proposal?.category).toBe(newCategory);
  });

  test('rejects invalid category value', async ({ request }) => {
    if (!proposalId) {
      test.skip(true, 'No proposal was created during setup');
      return;
    }

    const response = await apiRequest(
      request, 'POST', `/api/inbox_ops/proposals/${proposalId}/categorize`, {
        token,
        data: { category: 'invalid_category_value' },
      },
    );
    expect(response.status()).toBe(400);
    const body = await readJsonSafe<{ error: string }>(response);
    expect(body?.error).toBeTruthy();
  });

  test('UI shows category badge on proposal detail page', async ({ page }) => {
    if (!proposalId) {
      test.skip(true, 'No proposal was created during setup');
      return;
    }

    test.setTimeout(30000);
    await login(page, 'admin');
    await page.goto(`/backend/inbox-ops/proposals/${proposalId}`);

    // The proposal detail page should show the category
    // Look for the category badge or label text
    await expect(
      page.getByText(/inquiry|complaint|rfq|order|shipping_update|payment|other|order_update/i).first(),
    ).toBeVisible({ timeout: 10000 });
  });
});
