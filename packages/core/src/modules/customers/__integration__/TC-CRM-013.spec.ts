import { expect, test } from '@playwright/test';
import { createCompanyFixture, createDealFixture, deleteEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-CRM-013: Pipeline View Navigation
 * Source: .ai/qa/scenarios/TC-CRM-013-pipeline-view-navigation.md
 */
test.describe('TC-CRM-013: Pipeline View Navigation', () => {
  test('should display pipeline columns, show deal card info, open detail, and return to list view', async ({ page, request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    let dealId: string | null = null;

    const companyName = `QA TC-CRM-013 Co ${Date.now()}`;
    const dealTitle = `QA TC-CRM-013 Deal ${Date.now()}`;

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
        .filter({ has: page.locator('option', { hasText: 'Opportunity' }) })
        .first()
        .selectOption({ label: 'Opportunity' });
      await page.getByRole('button', { name: /Update deal/i }).click();

      await page.goto('/backend/customers/deals/pipeline');
      await expect(page.getByRole('heading', { name: 'Sales Pipeline' })).toBeVisible();
      await expect(page.getByText('Opportunity', { exact: true })).toBeVisible();
      await expect(page.getByText('Win', { exact: true })).toBeVisible();

      const dealCard = page
        .locator('div')
        .filter({ has: page.getByText(dealTitle, { exact: true }) })
        .first();
      await expect(dealCard).toBeVisible();
      await expect(page.getByText('$', { exact: false }).first()).toBeVisible();

      await page.locator(`a[href=\"/backend/customers/deals/${dealId}\"]`).click();
      await expect(page).toHaveURL(new RegExp(`/backend/customers/deals/${dealId}$`));
      await expect(page.getByText(dealTitle, { exact: true }).first()).toBeVisible();

      await page.goto('/backend/customers/deals');
      await expect(page.getByRole('heading', { name: 'Deals' })).toBeVisible();
      await page.getByRole('textbox', { name: /Search deals/i }).fill(dealTitle);
      await expect(page.getByRole('row', { name: new RegExp(dealTitle) })).toBeVisible();
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
