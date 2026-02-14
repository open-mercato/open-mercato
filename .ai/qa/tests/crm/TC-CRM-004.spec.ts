import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';
import { createCompanyFixture, deleteEntityIfExists } from '../helpers/crmFixtures';
import { getAuthToken } from '../helpers/api';

/**
 * TC-CRM-004: Create Contact/Person
 * Source: .ai/qa/scenarios/TC-CRM-004-person-creation.md
 */
test.describe('TC-CRM-004: Create Contact/Person', () => {
  test('should create a person with company association and show it in people list', async ({ page, request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    let personId: string | null = null;

    const firstName = `QA${Date.now()}`;
    const lastName = 'Person';
    const fullName = `${firstName} ${lastName}`;
    const companyName = `QA TC-CRM-004 Co ${Date.now()}`;

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, companyName);

      await login(page, 'admin');
      await page.goto('/backend/customers/people');
      await page.getByRole('link', { name: /New Person|Create Person/i }).first().click();

      await page.locator('form').getByRole('textbox').first().fill(firstName);
      await page.locator('form').getByRole('textbox').nth(1).fill(lastName);
      await page.getByPlaceholder('name@example.com').fill(`qa.crm004.${Date.now()}@example.com`);
      await page.getByPlaceholder('+00 000 000 000').fill('+1 555 010 0042');

      await page
        .locator('select')
        .filter({ has: page.locator('option', { hasText: companyName }) })
        .first()
        .selectOption({ label: companyName });

      await page.getByRole('button', { name: 'Create Person' }).first().click();

      await expect(page).toHaveURL(/\/backend\/customers\/people\/[0-9a-f-]{36}$/i);
      await expect(page.getByRole('button', { name: fullName, exact: true }).first()).toBeVisible();

      const idMatch = page.url().match(/\/backend\/customers\/people\/([0-9a-f-]{36})$/i);
      personId = idMatch?.[1] ?? null;
      expect(personId, 'Expected created person id in detail URL').toBeTruthy();

      await page.goto('/backend/customers/people');
      await page.getByRole('textbox', { name: /Search people/i }).fill(fullName);
      await expect(page.getByRole('link', { name: fullName, exact: true })).toBeVisible();
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
