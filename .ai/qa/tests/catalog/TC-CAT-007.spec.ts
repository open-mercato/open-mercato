import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';

/**
 * TC-CAT-007: Create Product Category
 * Source: .ai/qa/scenarios/TC-CAT-007-category-creation.md
 */
test.describe('TC-CAT-007: Create Product Category', () => {
  test('should create a root category and show it in categories list', async ({ page }) => {
    const categoryName = `QA TC-CAT-007 ${Date.now()}`;

    await login(page, 'admin');
    await page.goto('/backend/catalog/categories/create');

    await page.getByRole('textbox', { name: 'e.g., Footwear' }).fill(categoryName);
    await page.getByRole('button', { name: 'Create' }).last().click();

    await expect(page).toHaveURL(/\/backend\/catalog\/categories$/);
    const search = page.getByRole('textbox', { name: 'Search categories' });
    await search.fill(categoryName);
    await expect(page.getByText(categoryName, { exact: true }).first()).toBeVisible();
  });
});
