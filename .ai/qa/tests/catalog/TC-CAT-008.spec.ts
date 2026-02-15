import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';
import { apiRequest, getAuthToken } from '../helpers/api';

/**
 * TC-CAT-008: Create Nested Category Hierarchy
 * Source: .ai/qa/scenarios/TC-CAT-008-category-hierarchy.md
 */
test.describe('TC-CAT-008: Create Nested Category Hierarchy', () => {
  test('should create child category under an existing parent', async ({ page, request }) => {
    const parentName = `QA TC-CAT-008 Parent ${Date.now()}`;
    const childName = `QA TC-CAT-008 Child ${Date.now()}`;
    let token: string | null = null;
    let parentCategoryId: string | null = null;
    let childCategoryId: string | null = null;

    try {
      token = await getAuthToken(request);
      await login(page, 'admin');

      await page.goto('/backend/catalog/categories/create');
      await page.getByRole('textbox', { name: 'e.g., Footwear' }).fill(parentName);
      await page.getByRole('button', { name: 'Create' }).last().click();
      await expect(page).toHaveURL(/\/backend\/catalog\/categories$/);

      const search = page.getByRole('textbox', { name: 'Search categories' });
      await search.fill(parentName);
      const parentRow = page.getByRole('row', { name: new RegExp(parentName) });
      await expect(parentRow).toBeVisible();
      await parentRow.getByText(parentName, { exact: true }).first().click();
      await expect(page).toHaveURL(/\/backend\/catalog\/categories\/[0-9a-f-]{36}\/edit$/i);
      parentCategoryId = page.url().match(/\/backend\/catalog\/categories\/([0-9a-f-]{36})\/edit$/i)?.[1] ?? null;

      await page.goto('/backend/catalog/categories/create');
      const parentSelect = page.getByRole('combobox').filter({ hasText: 'Root level' }).first();
      await expect(parentSelect).toBeEnabled();
      await page.getByRole('textbox', { name: 'e.g., Footwear' }).fill(childName);
      await parentSelect.selectOption({ label: parentName });
      await page.getByRole('button', { name: 'Create' }).last().click();
      await expect(page).toHaveURL(/\/backend\/catalog\/categories$/);

      await search.fill(childName);
      const childRow = page.getByRole('row', { name: new RegExp(childName) });
      await expect(childRow).toContainText(parentName);
      await childRow.getByText(childName, { exact: true }).first().click();
      await expect(page).toHaveURL(/\/backend\/catalog\/categories\/[0-9a-f-]{36}\/edit$/i);
      childCategoryId = page.url().match(/\/backend\/catalog\/categories\/([0-9a-f-]{36})\/edit$/i)?.[1] ?? null;
    } finally {
      if (token && childCategoryId) {
        await apiRequest(request, 'DELETE', `/api/catalog/categories?id=${encodeURIComponent(childCategoryId)}`, { token }).catch(() => {});
      }
      if (token && parentCategoryId) {
        await apiRequest(request, 'DELETE', `/api/catalog/categories?id=${encodeURIComponent(parentCategoryId)}`, { token }).catch(() => {});
      }
    }
  });
});
