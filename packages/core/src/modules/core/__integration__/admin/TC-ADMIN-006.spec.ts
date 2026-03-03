import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-ADMIN-006: Feature Toggle Overrides
 * Source: .ai/qa/scenarios/TC-ADMIN-006-feature-toggle-override.md
 *
 * Verifies that the feature toggle overrides page displays per-tenant
 * overrides with proper columns, and that clicking an override shows
 * the detail view with enable/disable controls.
 *
 * Navigation: Settings → Feature Toggles → Overrides
 */
test.describe('TC-ADMIN-006: Feature Toggle Overrides', () => {
  test('should display overrides list and allow viewing override details', async ({ page }) => {
    await login(page, 'superadmin');

    // Navigate to overrides page
    await page.goto('/backend/feature-toggles/overrides');
    await expect(page.getByRole('heading', { name: 'Feature Toggle Overrides', level: 2 })).toBeVisible();
    await page.getByText('Loading data...').waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});

    // Verify table columns
    await expect(page.getByRole('columnheader', { name: 'Tenant' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Identifier' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Category' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Override State' })).toBeVisible();

    // Verify Refresh button
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();

    // Verify at least one override row exists
    const rows = page.locator('table tbody tr');
    await expect(rows.first()).toBeVisible();

    // Open row actions and navigate to detail view via explicit Edit action
    await page.getByRole('button', { name: 'Open actions' }).first().click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(page).toHaveURL(/\/backend\/feature-toggles\/global\/[^/]+$/);

    // Verify override section loads
    await expect(page.getByText('Override Mode')).toBeVisible();

    // Verify Enable Override checkbox
    await expect(page.getByRole('checkbox', { name: 'Enable Override' })).toBeVisible();

    // Verify Save Override button
    await expect(page.getByRole('button', { name: 'Save Override' })).toBeVisible();
  });
});
