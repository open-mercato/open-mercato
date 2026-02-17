import { expect, test } from '@playwright/test';
import { createCompanyFixture, createDealFixture, deleteEntityIfExists } from '../../core/__integration__/helpers/crmFixtures';
import { getAuthToken } from '../../core/__integration__/helpers/api';
import { login } from '../../core/__integration__/helpers/auth';

/**
 * TC-CRM-009: Update Deal Pipeline Stage
 * Source: .ai/qa/scenarios/TC-CRM-009-deal-pipeline-update.md
 */
test.describe('TC-CRM-009: Update Deal Pipeline Stage', () => {
  test('should update a deal pipeline stage to Win and reflect it in the pipeline board', async ({ page, request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    let dealId: string | null = null;

    const companyName = `QA TC-CRM-009 Co ${Date.now()}`;
    const dealTitle = `QA TC-CRM-009 Deal ${Date.now()}`;

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, companyName);
      dealId = await createDealFixture(request, token, {
        title: dealTitle,
        companyIds: [companyId],
      });

      await login(page, 'admin');
      await page.goto(`/backend/customers/deals/${dealId}`);

      await page
        .locator('select')
        .filter({ has: page.locator('option', { hasText: 'Win' }) })
        .nth(1)
        .selectOption({ label: 'Win' });
      await page.getByRole('button', { name: /Update deal/i }).click();
      await expect(page.getByText(/Win/i).first()).toBeVisible();

      await page.goto('/backend/customers/deals/pipeline');
      const winLane = page.locator('main').locator('div').filter({ has: page.getByText('Win', { exact: true }) }).first();
      await expect(winLane.getByText(dealTitle, { exact: true })).toBeVisible();
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
