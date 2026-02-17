import { expect, test } from '@playwright/test';
import { createCompanyFixture, createDealFixture, deleteEntityIfExists } from './helpers/crmFixtures';
import { getAuthToken } from './helpers/api';
import { login } from './helpers/auth';

/**
 * TC-CRM-010: Record Customer Activity
 * Source: .ai/qa/scenarios/TC-CRM-010-activity-recording.md
 */
test.describe('TC-CRM-010: Record Customer Activity', () => {
  test('should record a call activity on a deal timeline', async ({ page, request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    let dealId: string | null = null;

    const companyName = `QA TC-CRM-010 Co ${Date.now()}`;
    const dealTitle = `QA TC-CRM-010 Deal ${Date.now()}`;
    const subject = `QA TC-CRM-010 Activity ${Date.now()}`;

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, companyName);
      dealId = await createDealFixture(request, token, {
        title: dealTitle,
        companyIds: [companyId],
      });

      await login(page, 'admin');
      await page.goto(`/backend/customers/deals/${dealId}`);

      await page.getByRole('button', { name: 'Activities' }).click();
      await page.getByRole('button', { name: /Log activity|Add an activity/i }).first().click();

      const dialog = page.getByRole('dialog', { name: 'Add activity' });
      await dialog.getByRole('combobox').nth(1).selectOption({ label: dealTitle });
      await dialog.getByRole('combobox').nth(2).selectOption({ label: 'Call' });
      await dialog.getByRole('textbox', { name: 'Add a subject (optional)' }).fill(subject);
      await dialog.getByRole('textbox', { name: 'Describe the interaction' }).fill('QA activity body for TC-CRM-010');
      await dialog.getByRole('button', { name: /Save activity/i }).click();

      await expect(dialog).toBeHidden();
      await expect(page.getByText('No activities yet')).not.toBeVisible();
      await expect(page.getByText(subject).first()).toBeVisible();
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
