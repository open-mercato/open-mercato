import { expect, test } from '@playwright/test';
import { createCompanyFixture, createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-CRM-005: Link Person to Company
 * Source: .ai/qa/scenarios/TC-CRM-005-person-link-to-company.md
 */
test.describe('TC-CRM-005: Link Person to Company', () => {
  test('should link a person to a company from person detail and show person on company page', async ({ page, request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    let personId: string | null = null;

    const companyName = `QA TC-CRM-005 Co ${Date.now()}`;
    const firstName = `QA${Date.now()}`;
    const lastName = 'Link';
    const displayName = `${firstName} ${lastName}`;

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, companyName);
      personId = await createPersonFixture(request, token, {
        firstName,
        lastName,
        displayName,
      });

      await login(page, 'admin');
      await page.goto(`/backend/customers/people/${personId}`);

      await page.getByRole('button', { name: 'ui.forms.actions.edit' }).first().click();
      await page
        .locator('select')
        .filter({ has: page.locator('option', { hasText: companyName }) })
        .first()
        .selectOption({ label: companyName });
      await page.getByRole('button', { name: /^Save$/ }).click();
      await expect(page.getByText(companyName, { exact: true })).toBeVisible();

      await page.goto(`/backend/customers/companies/${companyId}`);
      await page.getByRole('tab', { name: 'People' }).click();
      await expect(page.getByText(displayName, { exact: true })).toBeVisible();
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
