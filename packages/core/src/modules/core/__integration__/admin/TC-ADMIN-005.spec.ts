import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';

/**
 * TC-ADMIN-005: Feature Toggles Management
 * Source: .ai/qa/scenarios/TC-ADMIN-005-feature-toggle-create.md
 *
 * Verifies that the feature toggles page is accessible to superadmins,
 * displays existing toggles with proper columns, and has a working
 * create form with all expected fields.
 *
 * Navigation: Settings → Feature Toggles → Global
 */
test.describe('TC-ADMIN-005: Feature Toggles Management', () => {
  test('should display feature toggles list and create form for superadmin', async ({ page }) => {
    await login(page, 'superadmin');

    await page.goto('/backend/feature-toggles/global');
    await expect(page.getByRole('heading', { name: /Feature Toggles/i })).toBeVisible();
    await page.getByText('Loading data...').waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});

    await expect(page.getByRole('columnheader', { name: 'Category' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Identifier' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Type' })).toBeVisible();

    const createLink = page.getByRole('link', { name: /^Create$/i }).first();
    if (await createLink.isVisible().catch(() => false)) {
      await createLink.click();
    } else {
      await page.getByRole('button', { name: /^Create$/i }).first().click();
    }
    await expect(page).toHaveURL(/\/backend\/feature-toggles\/global\/create(?:\?.*)?$/);
    await expect(page.locator('main').getByText('Create Feature Toggle', { exact: true })).toBeVisible();

    await expect(page.getByText('Basic Information')).toBeVisible();
    await expect(page.getByText('Type Configuration')).toBeVisible();
    await expect(page.getByText('Default Value', { exact: true })).toBeVisible();

    const textboxes = page.locator('main').getByRole('textbox');
    expect(await textboxes.count()).toBeGreaterThanOrEqual(3);

    const comboboxes = page.locator('main').getByRole('combobox');
    expect(await comboboxes.count()).toBeGreaterThan(0);

    await expect(page.getByRole('button', { name: 'Save' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Back/i }).first()).toBeVisible();
  });
});
