import { expect, test } from '@playwright/test';
import { createCompanyFixture, createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
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

      await page.getByRole('button', { name: /^Edit$/i }).first().click();
      // Person detail page renders CompanySelectField directly (no CrudForm wrapper).
      // Scope to the placeholder visible in the trigger when no company is selected.
      const companyCombobox = page.locator('[role="combobox"]').filter({ hasText: 'Select a company' });
      await expect(companyCombobox).toBeVisible({ timeout: 10_000 });
      await companyCombobox.click();
      await page.getByRole('option', { name: companyName, exact: true }).click();
      const saveResponsePromise = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return response.request().method() === 'PUT' && url.pathname === '/api/customers/people';
      });
      await page.getByRole('button', { name: /^Save$/ }).click();
      const saveResponse = await saveResponsePromise;
      expect(saveResponse.status(), `PUT /api/customers/people returned ${saveResponse.status()}`).toBeLessThan(400);
      await expect(page.getByText(companyName, { exact: true })).toBeVisible();

      await expect.poll(async () => {
        const response = await apiRequest(
          request,
          'GET',
          `/api/customers/companies/${companyId}?include=people`,
          { token: token as string },
        );
        if (!response.ok()) return false;
        const body = await response.json();
        const people = Array.isArray(body?.people) ? body.people : [];
        return people.some((person: Record<string, unknown>) => person.id === personId || person.displayName === displayName);
      }).toBe(true);

      await page.goto(`/backend/customers/companies/${companyId}`);
      await page.getByRole('tab', { name: 'People' }).click();
      await expect(page.getByText(displayName, { exact: true })).toBeVisible();
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
