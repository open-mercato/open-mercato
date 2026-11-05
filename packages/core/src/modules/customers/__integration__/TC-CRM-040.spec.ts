import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createCompanyFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';

/**
 * TC-CRM-040: Object-history icon on Company detail header
 * Spec: .ai/specs/2026-04-23-crm-post-upgrade-bug-fixes.md Phase 1
 *
 * Verifies that the Object-history utility icon appears in the bespoke
 * CompanyDetailHeader and opens the Version History panel scoped to the company.
 */
test.describe('TC-CRM-040: Company header exposes Object-history icon', () => {
  test('shows Version History icon and opens the history panel from the company detail header', async ({
    page,
    request,
  }) => {
    test.slow();

    let token: string | null = null;
    let companyId: string | null = null;
    const companyName = `QA TC-CRM-040 ${Date.now()}`;

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, companyName);

      await login(page, 'admin');
      await page.goto(`/backend/customers/companies-v2/${companyId}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: companyName, exact: true })).toBeVisible({ timeout: 15000 });

      const historyButton = page.getByRole('button', { name: 'Version History' });
      await expect(historyButton).toBeVisible();

      await historyButton.click();

      await expect(page.getByRole('dialog', { name: 'Version History' })).toBeVisible({
        timeout: 10000,
      });
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
