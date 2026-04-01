import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { createCompanyFixture, deleteEntityIfExists, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';

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
      await page.goto('/backend/customers/people/create');

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

      await expect(page).toHaveURL(/\/backend\/customers\/people-v2\/[0-9a-f-]{36}$/i);
      await expect(page.getByText(fullName, { exact: true }).first()).toBeVisible();

      const idMatch = page.url().match(/\/backend\/customers\/people-v2\/([0-9a-f-]{36})$/i);
      personId = idMatch?.[1] ?? null;
      expect(personId, 'Expected created person id in detail URL').toBeTruthy();

      const listResponse = await apiRequest(
        request,
        'GET',
        '/api/customers/people?page=1&pageSize=100',
        { token },
      );
      expect(listResponse.ok()).toBeTruthy();
      const listBody = (await readJsonSafe<{
        items?: Array<{ id?: unknown; display_name?: unknown }>;
      }>(listResponse)) ?? {};
      const items = Array.isArray(listBody.items) ? listBody.items : [];
      const createdPerson =
        items.find((item) => item && typeof item === 'object' && (item as { id?: unknown }).id === personId) ?? null;
      expect(createdPerson).toBeTruthy();
      expect((createdPerson as { display_name?: unknown }).display_name).toBe(fullName);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
