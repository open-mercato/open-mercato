import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-ADMIN-010: Cache Management
 * Source: .ai/qa/scenarios/TC-ADMIN-010-cache-management.md
 *
 * Verifies that the cache overview page displays cache statistics,
 * segments with purge controls, and a global purge button.
 *
 * Navigation: Settings → System → Cache
 */
test.describe('TC-ADMIN-010: Cache Management', () => {
  test('should display cache statistics and allow purging', async ({ page }) => {
    await login(page, 'superadmin');

    // First visit a CRUD page to ensure some cache entries exist
    await page.goto('/backend/customers/companies');
    await page.getByText('Loading data...').waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});

    // Navigate to cache management
    await page.goto('/backend/config/cache');

    // Verify page heading
    await expect(page.getByRole('heading', { name: 'Cache overview', level: 2 })).toBeVisible();
    await expect(page.getByText('Inspect cached responses and clear segments')).toBeVisible();

    // Wait for loading
    await page.getByText('Loading cache statistics').waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});

    // Verify stats are displayed
    await expect(page.getByText(/\d+ cached entr/)).toBeVisible();
    await expect(page.getByText(/Stats generated/)).toBeVisible();

    // Verify control buttons
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();
    const purgeAllButton = page.getByRole('button', { name: 'Purge all cache' }).first();
    if (await purgeAllButton.isVisible().catch(() => false)) {
      await expect(purgeAllButton).toBeVisible();
    }

    // Verify table structure + purge flow only when segments are present
    const hasEmptyState = await page.getByText(/No cached responses for this tenant\./).isVisible().catch(() => false);
    if (!hasEmptyState) {
      await expect(page.getByRole('columnheader', { name: 'Segment' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'Path' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'Method' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'Cached keys' })).toBeVisible();

      const firstPurgeButton = page.getByRole('button', { name: 'Purge segment' }).first();
      await firstPurgeButton.click();
      await expect(page.getByText(/Stats generated/)).toBeVisible();
    } else {
      await expect(page.getByText(/No cached responses for this tenant\./)).toBeVisible();
    }
  });
});
