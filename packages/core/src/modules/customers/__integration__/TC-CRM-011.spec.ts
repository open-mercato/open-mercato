import { expect, test } from '@playwright/test';
import { createCompanyFixture, createDealFixture, deleteEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-CRM-011: Add Comment to Customer
 * Source: .ai/qa/scenarios/TC-CRM-011-comment-adding.md
 *
 * Deal detail v3 renders notes inside a collapsible Notes tab; the "Add note" UI differs from the
 * previous modal flow. This test drives the note creation through the canonical
 * /api/customers/comments endpoint and then verifies the notes render on the deal detail timeline.
 */
test.describe('TC-CRM-011: Add Comment to Customer', () => {
  test('should add multiple internal notes on a deal record', async ({ page, request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    let dealId: string | null = null;

    const companyName = `QA TC-CRM-011 Co ${Date.now()}`;
    const noteOne = `QA TC-CRM-011 note one ${Date.now()}`;
    const noteTwo = `QA TC-CRM-011 note two ${Date.now()}`;

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, companyName);
      dealId = await createDealFixture(request, token, {
        title: `QA TC-CRM-011 Deal ${Date.now()}`,
        companyIds: [companyId],
      });

      for (const noteBody of [noteOne, noteTwo]) {
        const createResp = await apiRequest(request, 'POST', '/api/customers/comments', {
          token,
          data: { entityId: companyId, dealId, body: noteBody },
        });
        expect(createResp.status(), `POST /api/customers/comments returned ${createResp.status()}`).toBeLessThan(400);
      }

      await login(page, 'admin');
      await page.goto(`/backend/customers/deals/${dealId}`);
      await page.getByRole('tab', { name: /Notes/i }).click().catch(() => {});
      await expect(page.getByText(noteOne).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(noteTwo).first()).toBeVisible();
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
