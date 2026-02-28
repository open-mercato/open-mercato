import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-ADMIN-007: Custom Entity Creation
 * Source: .ai/qa/scenarios/TC-ADMIN-007-custom-entity-creation.md
 *
 * Verifies that the User Entities page displays existing entities,
 * and that the create form has all expected fields.
 *
 * Navigation: Settings → Data Designer → User Entities
 */
test.describe('TC-ADMIN-007: Custom Entity Creation', () => {
  test('should display user entities list and create form', async ({ page }) => {
    await login(page, 'superadmin');

    // Navigate to User Entities
    await page.goto('/backend/entities/user');
    await expect(page.getByRole('heading', { name: 'User Entities', level: 2 })).toBeVisible();
    await page.getByText('Loading data...').waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});

    // Verify table columns
    await expect(page.getByRole('columnheader', { name: /Entity/ })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Label' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Source' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Fields' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'In Sidebar' })).toBeVisible();

    // Verify at least one entity row exists
    const rows = page.locator('table tbody tr');
    await expect(rows.first()).toBeVisible();

    // Verify Export and Create buttons
    await expect(page.getByRole('button', { name: 'Export' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create' })).toBeVisible();

    // Verify Search box
    await expect(page.getByRole('textbox', { name: 'Search' })).toBeVisible();

    // Navigate to Create form
    await page.getByRole('link', { name: 'Create' }).click();
    await expect(page).toHaveURL(/\/backend\/entities\/user\/create$/);
    await expect(page.getByText('Create Entity')).toBeVisible();

    // Verify form fields
    await expect(page.getByText('Entity ID', { exact: false })).toBeVisible();
    await expect(page.getByText('Label', { exact: false })).toBeVisible();
    await expect(page.getByText('Description')).toBeVisible();

    // Verify Entity ID default placeholder value
    const entityIdField = page.getByRole('textbox', { name: 'module_name:entity_id' });
    await expect(entityIdField).toBeVisible();
    await expect(entityIdField).toHaveValue('user:your_entity');

    // Verify Default Editor combobox
    await expect(page.locator('main').getByRole('combobox')).toBeVisible();

    // Verify Show in sidebar checkbox
    await expect(page.getByRole('checkbox', { name: 'Show in sidebar' })).toBeVisible();

    // Verify Create and Cancel buttons
    await expect(page.getByRole('button', { name: 'Create' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Cancel' }).first()).toBeVisible();

    // Verify Back link
    await expect(page.getByRole('link', { name: '← Back' })).toBeVisible();
  });
});
