import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createCompanyFixture,
  createDealFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';

/**
 * TC-CRM-041: Object-history icon on Deal detail header
 * Spec: .ai/specs/2026-04-23-crm-post-upgrade-bug-fixes.md Phase 1
 *
 * Verifies that the Object-history utility icon appears in the bespoke
 * DealDetailHeader and opens the Version History panel scoped to the deal.
 */
test.describe('TC-CRM-041: Deal header exposes Object-history icon', () => {
  test('shows Version History icon and opens the history panel from the deal detail header', async ({
    page,
    request,
  }) => {
    test.slow();

    let token: string | null = null;
    let companyId: string | null = null;
    let dealId: string | null = null;
    const stamp = Date.now();
    const companyName = `QA TC-CRM-041 Co ${stamp}`;
    const dealTitle = `QA TC-CRM-041 Deal ${stamp}`;

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, companyName);
      dealId = await createDealFixture(request, token, {
        title: dealTitle,
        companyIds: [companyId],
      });

      await login(page, 'admin');
      await page.goto(`/backend/customers/deals/${dealId}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: dealTitle, exact: true })).toBeVisible({ timeout: 15000 });

      const historyButton = page.getByRole('button', { name: 'Version History' });
      await expect(historyButton).toBeVisible();

      await historyButton.click();

      await expect(page.getByRole('dialog', { name: 'Version History' })).toBeVisible({
        timeout: 10000,
      });
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
