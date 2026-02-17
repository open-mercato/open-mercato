import { expect, test } from '@playwright/test';
import { createCompanyFixture, createDealFixture, createPersonFixture, deleteEntityIfExists } from '../../core/__integration__/helpers/crmFixtures';
import { getAuthToken } from '../../core/__integration__/helpers/api';
import { login } from '../../core/__integration__/helpers/auth';

/**
 * TC-CRM-008: Add Participants to Deal
 * Source: .ai/qa/scenarios/TC-CRM-008-deal-participant-add.md
 */
test.describe('TC-CRM-008: Add Participants to Deal', () => {
  test('should add a person and an additional company as deal participants', async ({ page, request }) => {
    let token: string | null = null;
    let primaryCompanyId: string | null = null;
    let secondaryCompanyId: string | null = null;
    let personId: string | null = null;
    let dealId: string | null = null;

    const primaryCompanyName = `QA TC-CRM-008 Primary ${Date.now()}`;
    const secondaryCompanyName = `QA TC-CRM-008 Secondary ${Date.now()}`;
    const firstName = `QA${Date.now()}`;
    const lastName = 'Participant';
    const displayName = `${firstName} ${lastName}`;

    try {
      token = await getAuthToken(request);
      primaryCompanyId = await createCompanyFixture(request, token, primaryCompanyName);
      secondaryCompanyId = await createCompanyFixture(request, token, secondaryCompanyName);
      personId = await createPersonFixture(request, token, {
        firstName,
        lastName,
        displayName,
        companyEntityId: primaryCompanyId,
      });
      dealId = await createDealFixture(request, token, {
        title: `QA TC-CRM-008 Deal ${Date.now()}`,
        companyIds: [primaryCompanyId],
      });

      await login(page, 'admin');
      await page.goto(`/backend/customers/deals/${dealId}`);

      await page.getByRole('textbox', { name: 'Search people…' }).fill(displayName);
      await page.getByRole('button', { name: new RegExp(displayName) }).first().click();

      await page.getByRole('textbox', { name: 'Search companies…' }).fill(secondaryCompanyName);
      await page.getByRole('button', { name: secondaryCompanyName, exact: true }).first().click();

      await page.getByRole('button', { name: /Update deal/i }).click();

      await expect(page.getByRole('button', { name: new RegExp(`Remove ${displayName}`) })).toBeVisible();
      await expect(page.getByRole('button', { name: new RegExp(`Remove ${secondaryCompanyName}`) })).toBeVisible();

      await expect(page.getByRole('link', { name: displayName, exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: secondaryCompanyName, exact: true })).toBeVisible();
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', secondaryCompanyId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', primaryCompanyId);
    }
  });
});
