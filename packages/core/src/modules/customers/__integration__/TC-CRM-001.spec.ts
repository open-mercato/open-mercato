import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { deleteEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';

/**
 * TC-CRM-001: Company Creation
 * Source: .ai/qa/scenarios/TC-CRM-001-company-creation.md
 */
test.describe('TC-CRM-001: Company Creation', () => {
  test('should create a company from create form and show it in companies list', async ({ page, request }) => {
    test.slow();

    let token: string | null = null;
    let companyId: string | null = null;
    const companyName = `QA TC-CRM-001 ${Date.now()}`;

    try {
      token = await getAuthToken(request);

      await login(page, 'admin');
      await page.goto('/backend/customers/companies/create');
      await page.locator('form').getByRole('textbox').first().fill(companyName);
      await page.getByPlaceholder('https://example.com').fill('https://example.com');
      await page.locator('form').getByRole('button', { name: /Create Company/i }).click();

      await expect(page).toHaveURL(/\/backend\/customers\/companies-v2\/[0-9a-f-]{36}$/i);
      await expect(page.getByText(companyName, { exact: true }).first()).toBeVisible();

      const url = page.url();
      const idMatch = url.match(/\/backend\/customers\/companies-v2\/([0-9a-f-]{36})$/i);
      companyId = idMatch ? idMatch[1] : null;
      expect(companyId, 'Expected created company id in detail URL').toBeTruthy();

      await expect
        .poll(
          async () => {
            const listResponse = await apiRequest(
              request,
              'GET',
              `/api/customers/companies?search=${encodeURIComponent(companyName)}&pageSize=20`,
              { token: token! },
            );
            if (!listResponse.ok()) return false;
            const payload = await listResponse.json() as {
              items?: Array<{ id?: unknown; display_name?: unknown }>;
            };
            const items = Array.isArray(payload.items) ? payload.items : [];
            return items.some((item) => (
              (typeof item.id === 'string' && item.id === companyId)
              || (typeof item.display_name === 'string' && item.display_name === companyName)
            ));
          },
          { timeout: 60000 },
        )
        .toBe(true);

      await page.goto('/backend/customers/companies', { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Refresh' }).waitFor();
      const contactDialog = page.getByRole('dialog', { name: /Talk to Open Mercato team/i });
      if (await contactDialog.count()) {
        await contactDialog.getByRole('button', { name: 'Close' }).click().catch(() => {});
      }
      const searchInput = page.getByRole('textbox', { name: /Search companies/i });
      await searchInput.fill(companyName);
      await page.waitForTimeout(1200);
      await expect
        .poll(
          async () => {
            await page.getByText('Loading table', { exact: false }).waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
            return await page.getByRole('link', { name: companyName, exact: true }).count();
          },
          { timeout: 15000 },
        )
        .toBeGreaterThan(0);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
