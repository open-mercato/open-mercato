import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';

/**
 * TC-CAT-008: Create Nested Category Hierarchy
 * Source: .ai/qa/scenarios/TC-CAT-008-category-hierarchy.md
 */
test.describe('TC-CAT-008: Create Nested Category Hierarchy', () => {
  test('should create child category under an existing parent', async ({ page }) => {
    const parentName = `QA TC-CAT-008 Parent ${Date.now()}`;
    const childName = `QA TC-CAT-008 Child ${Date.now()}`;

    await login(page, 'admin');

    await page.goto('/backend/catalog/categories/create');
    await page.getByRole('textbox', { name: 'e.g., Footwear' }).fill(parentName);
    await page.getByRole('button', { name: 'Create' }).last().click();
    await expect(page).toHaveURL(/\/backend\/catalog\/categories$/);

    await page.goto('/backend/catalog/categories/create');
    const parentSelect = page.getByRole('combobox').filter({ hasText: 'Root level' }).first();
    await expect(parentSelect).toBeEnabled();
    await page.getByRole('textbox', { name: 'e.g., Footwear' }).fill(childName);
    await parentSelect.selectOption({ label: parentName });
    await page.getByRole('button', { name: 'Create' }).last().click();
    await expect(page).toHaveURL(/\/backend\/catalog\/categories$/);

    const search = page.getByRole('textbox', { name: 'Search categories' });
    await search.fill(childName);
    const row = page.getByRole('row', { name: new RegExp(childName) });
    await expect(row).toContainText(parentName);
  });
});

