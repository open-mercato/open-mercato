import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-CRM-032: DataTable Column Chooser
 * Verifies that the Views sidebar (which embeds the column chooser) opens,
 * allows toggling column visibility, and the table reflects the changes.
 *
 * Updated for T-FE-02 / SPEC-070: the standalone "Choose columns" toolbar
 * button was removed and the column chooser is now hosted inside the
 * Views sidebar opened from the ViewSwitcherDropdown.
 */
test.describe('TC-CRM-032: DataTable Column Chooser', () => {
  test('should toggle column visibility via Views sidebar on people page', async ({ page }) => {
    test.slow();

    await login(page, 'admin');
    await page.goto('/backend/customers/people', { waitUntil: 'domcontentloaded' });
    await page.getByText('Loading table', { exact: false }).waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

    const emailHeader = page.locator('thead button', { hasText: 'Email' }).first();
    await expect(emailHeader).toBeVisible();

    const viewsToolbarButton = page.getByTestId('data-table-open-views-sidebar').first();
    await expect(viewsToolbarButton).toBeVisible();
    await viewsToolbarButton.click();

    const sidebarBackButton = page.getByRole('button', { name: 'Close', exact: true });
    await expect(sidebarBackButton).toBeVisible();

    // Email is in the "Shown" section. Each row contains a label span with the
    // column name and a Switch (role="switch"). Filter the row by exact text
    // and the presence of a switch to avoid matching unrelated DOM nodes.
    const emailShownRow = page
      .locator('div')
      .filter({ hasText: /^Email$/ })
      .filter({ has: page.locator('[role="switch"]') })
      .first();
    const emailShownSwitch = emailShownRow.getByRole('switch');
    await expect(emailShownSwitch).toBeVisible();
    await expect(emailShownSwitch).toHaveAttribute('aria-checked', 'true');
    await emailShownSwitch.click();

    // Close sidebar to verify the table reflects the change.
    await sidebarBackButton.click();
    await expect(sidebarBackButton).not.toBeVisible();
    await expect(emailHeader).not.toBeVisible();

    // Re-open the sidebar and re-enable Email from the "Available" section.
    await viewsToolbarButton.click();
    await expect(sidebarBackButton).toBeVisible();

    // Available columns are grouped and collapsed by default; typing in the
    // search input filters and auto-expands matching groups.
    const searchInput = page.getByPlaceholder('Search columns...');
    await searchInput.fill('Email');

    const emailAvailableRow = page
      .locator('div')
      .filter({ hasText: /^Email$/ })
      .filter({ has: page.locator('[role="switch"]') })
      .first();
    const emailAvailableSwitch = emailAvailableRow.getByRole('switch');
    await expect(emailAvailableSwitch).toBeVisible();
    await expect(emailAvailableSwitch).toHaveAttribute('aria-checked', 'false');
    await emailAvailableSwitch.click();

    await page.getByRole('button', { name: 'Close', exact: true }).click();

    await expect(page.locator('thead button', { hasText: 'Email' }).first()).toBeVisible();
  });
});
