import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { deleteEntityIfExists, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';

/**
 * TC-CRM-ANNUAL-REVENUE-LOCALE-001: comma-decimal Annual revenue parsing and long display-name wrapping
 * Follow-up from PR #8764 (fix #8642): regression coverage for the pl-PL comma-decimal
 * Annual revenue parse and the long-display-name page-overflow fix.
 */
test.describe('TC-CRM-ANNUAL-REVENUE-LOCALE-001: Annual revenue locale parsing and display-name wrapping', () => {
  test('parses a pl-PL comma-decimal Annual revenue amount on company create', async ({ page, request, baseURL }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    const companyName = `QA TC-CRM-ANNUAL-REVENUE ${Date.now()}`;

    try {
      token = await getAuthToken(request);

      await login(page, 'admin');
      expect(baseURL).toBeTruthy();
      await page.context().addCookies([{ name: 'locale', value: 'pl', url: baseURL! }]);

      await page.goto('/backend/customers/companies/create');
      await page.locator('form').getByRole('textbox').first().fill(companyName);
      await page.locator('[data-crud-field-id="annualRevenue"] input').fill('1 234,50');
      await page.locator('form button[type="submit"]').click();

      await expect(page).toHaveURL(/\/backend\/customers\/companies-v2\/[0-9a-f-]{36}$/i);
      const idMatch = page.url().match(/\/backend\/customers\/companies-v2\/([0-9a-f-]{36})$/i);
      companyId = idMatch?.[1] ?? null;
      expect(companyId, 'Expected created company id in detail URL').toBeTruthy();

      const detailResponse = await apiRequest(
        request,
        'GET',
        `/api/customers/companies?id=${companyId}`,
        { token },
      );
      expect(detailResponse.ok()).toBeTruthy();
      const detailBody = (await readJsonSafe<{
        items?: Array<{ id?: unknown; annual_revenue?: unknown }>;
      }>(detailResponse)) ?? {};
      const items = Array.isArray(detailBody.items) ? detailBody.items : [];
      const created = items.find((item) => item && typeof item === 'object' && (item as { id?: unknown }).id === companyId);
      expect(created, 'Expected created company in API response').toBeTruthy();
      expect(Number((created as { annual_revenue?: unknown }).annual_revenue)).toBe(1234.5);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });

  test('wraps a long unbroken display name instead of overflowing the page on person create', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/backend/customers/people/create');

    const longFirstName = 'a'.repeat(140);
    await page.locator('form').getByRole('textbox').first().fill(longFirstName);
    await page.locator('form').getByRole('textbox').nth(1).fill('Overflow');

    await expect(page.getByText(longFirstName, { exact: false }).first()).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
});
