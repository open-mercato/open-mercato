import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-CRM-033: DataTable Page Size Selector
 * Verifies that the page size dropdown changes the number of rows displayed.
 */
test.describe('TC-CRM-033: DataTable Page Size Selector', () => {
  test('should change page size on people list via dropdown', async ({ page }) => {
    test.slow();

    await login(page, 'admin');
    await page.goto('/backend/customers/people', { waitUntil: 'domcontentloaded' });
    await page.getByText('Loading table', { exact: false }).waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

    await expect
      .poll(async () => page.locator('tbody tr').count(), { timeout: 15000 })
      .toBeGreaterThan(0);

    // DS v5 Pagination primitive renders the page-size trigger with aria-label="Items per page".
    // The visible label includes the "per page" suffix (e.g. "25 per page"), so locate by role + aria-label.
    const pageSizeTrigger = page.getByRole('combobox', { name: 'Items per page' })
    await expect(pageSizeTrigger).toBeVisible({ timeout: 5000 });
    await pageSizeTrigger.click();
    // Pagination options use the same "per page" suffix as the trigger label.
    await page.getByRole('option', { name: '10 per page', exact: true }).click();
    await page.getByText('Loading table', { exact: false }).waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

    const rowCount = await page.locator('tbody tr').count();
    expect(rowCount).toBeLessThanOrEqual(10);
  });
});
