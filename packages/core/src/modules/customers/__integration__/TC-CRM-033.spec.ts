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

    const pageSizeSelect = page.locator('select').filter({ hasText: /per page/i }).or(
      page.locator('select').filter({ has: page.locator('option[value="25"]') })
    ).first();
    await expect(pageSizeSelect).toBeVisible({ timeout: 5000 });

    await pageSizeSelect.selectOption('10');
    await page.getByText('Loading table', { exact: false }).waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

    const rowCount = await page.locator('tbody tr').count();
    expect(rowCount).toBeLessThanOrEqual(10);
  });
});
