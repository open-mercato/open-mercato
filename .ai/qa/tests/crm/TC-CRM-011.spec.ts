import { expect, test } from '@playwright/test';
import { createCompanyFixture, createDealFixture, deleteEntityIfExists } from '../helpers/crmFixtures';
import { getAuthToken } from '../helpers/api';
import { login } from '../helpers/auth';

/**
 * TC-CRM-011: Add Comment to Customer
 * Source: .ai/qa/scenarios/TC-CRM-011-comment-adding.md
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

      await login(page, 'admin');
      await page.goto(`/backend/customers/deals/${dealId}`);

      await page.getByRole('button', { name: 'Notes' }).click();
      await page.getByRole('button', { name: /Add a note|Write the first note/i }).first().click();

      const firstDialog = page.getByRole('dialog').last();
      await firstDialog.getByRole('textbox').first().fill(noteOne);
      await firstDialog.getByRole('button', { name: /Add note|Save/i }).first().click();
      await expect(page.getByText(noteOne)).toBeVisible();

      await page.getByRole('button', { name: /Add a note|Write the first note/i }).first().click();
      const secondDialog = page.getByRole('dialog').last();
      await secondDialog.getByRole('textbox').first().fill(noteTwo);
      await secondDialog.getByRole('button', { name: /Add note|Save/i }).first().click();
      await expect(page.getByText(noteTwo)).toBeVisible();
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
