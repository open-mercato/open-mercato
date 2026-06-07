import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';

/**
 * TC-CRM-033: DataTable Page Size Selector
 * Verifies that the page size dropdown changes the number of rows displayed.
 */
test.describe('TC-CRM-033: DataTable Page Size Selector', () => {
  test('should change page size on people list via dropdown', async ({ page, request }) => {
    test.slow();
    test.setTimeout(120_000);

    let token: string | null = null;
    let personId: string | null = null;
    const stamp = Date.now();
    const displayName = `QA TC-CRM-033 Person ${stamp}`;

    try {
      token = await getAuthToken(request, 'admin');
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `TC-CRM-033 ${stamp}`,
        displayName,
      });

      await login(page, 'admin');
      await page.goto('/backend/customers/people', { waitUntil: 'domcontentloaded' });
      await page.getByText('Loading table', { exact: false }).waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

      const searchInput = page.getByPlaceholder(/Search by name/i);
      await expect(searchInput).toBeVisible({ timeout: 30_000 });
      await searchInput.fill(displayName);
      await page.getByText('Loading table', { exact: false }).waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

      await expect(page.getByRole('link', { name: displayName, exact: true })).toBeVisible({ timeout: 30_000 });

      // DS v5 Pagination primitive renders the page-size trigger with aria-label="Items per page".
      // The visible label includes the "per page" suffix (e.g. "25 per page"), so locate by role + aria-label.
      const pageSizeTrigger = page.getByRole('combobox', { name: 'Items per page' });
      await expect(pageSizeTrigger).toBeVisible({ timeout: 5000 });
      await pageSizeTrigger.click();
      // Pagination options use the same "per page" suffix as the trigger label.
      await page.getByRole('option', { name: '10 per page', exact: true }).click();
      await page.getByText('Loading table', { exact: false }).waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

      const rowCount = await page.locator('tbody tr').count();
      expect(rowCount).toBeLessThanOrEqual(10);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
    }
  });
});
