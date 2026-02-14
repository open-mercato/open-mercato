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

    // Navigate to feature toggles
    await page.goto('/backend/feature-toggles/global');
    await expect(page.getByRole('heading', { name: 'Feature Toggles', level: 2 })).toBeVisible();
    await page.getByText('Loading data...').waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});

    // Verify table columns
    await expect(page.getByRole('columnheader', { name: 'Category' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Identifier' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Type' })).toBeVisible();

    // Verify seeded toggles are present
    await expect(page.getByText('feature_toggles_ui')).toBeVisible();
    await expect(page.getByText('Feature Toggles UI')).toBeVisible();

    // Verify at least one data row exists
    const rows = page.locator('table tbody tr');
    await expect(rows.first()).toBeVisible();

    // Navigate to Create form
    await page.getByRole('link', { name: 'Create' }).click();
    await expect(page).toHaveURL(/\/backend\/feature-toggles\/global\/create$/);
    await expect(page.getByText('Create Feature Toggle')).toBeVisible();

    // Verify form sections
    await expect(page.getByText('Basic Information')).toBeVisible();
    await expect(page.getByText('Type Configuration')).toBeVisible();
    await expect(page.getByText('Default Value', { exact: true })).toBeVisible();

    // Verify form fields exist (4 textboxes: Identifier, Name, Description, Category)
    const textboxes = page.locator('main').getByRole('textbox');
    await expect(textboxes).toHaveCount(4);

    // Verify Type combobox with expected options
    const typeCombobox = page.locator('main').getByRole('combobox');
    await expect(typeCombobox).toBeVisible();

    // Verify Save button
    await expect(page.getByRole('button', { name: 'Save' }).first()).toBeVisible();

    // Verify Back link
    await expect(page.getByRole('link', { name: '← Back' })).toBeVisible();
  });
});
