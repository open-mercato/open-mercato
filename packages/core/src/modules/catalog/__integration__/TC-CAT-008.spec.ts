import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * TC-CAT-008: Create Nested Category Hierarchy
 * Source: .ai/qa/scenarios/TC-CAT-008-category-hierarchy.md
 */
test.describe('TC-CAT-008: Create Nested Category Hierarchy', () => {
  test('should create child category under an existing parent', async ({ page, request }) => {
    const stamp = Date.now();
    const parentName = `QA TC-CAT-008 Parent ${stamp}`;
    const childName = `QA TC-CAT-008 Child ${stamp}`;
    let token: string | null = null;
    let parentCategoryId: string | null = null;
    let childCategoryId: string | null = null;

    const waitForList = async (): Promise<void> => {
      await page.getByText('Loading data...').waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
    };

    const selectParent = async (): Promise<void> => {
      const parentSelect = page.getByRole('combobox').filter({ hasText: /Root level/i }).first();
      await expect(parentSelect).toBeEnabled();
      if (parentCategoryId) {
        const parentId = parentCategoryId;
        await parentSelect.selectOption(parentId).catch(async () => {
          await parentSelect.selectOption({ value: parentId }).catch(() => {});
        });
      }
      const selectedValue = await parentSelect.inputValue().catch(() => '');
      if (parentCategoryId && selectedValue === parentCategoryId) {
        return;
      }
      await parentSelect.selectOption({ label: parentName }).catch(async () => {
        const selectedValue = await parentSelect.evaluate((element, label) => {
          const select = element as HTMLSelectElement;
          const option = Array.from(select.options).find((entry) => entry.text.trim() === label);
          return option?.value ?? null;
        }, parentName);
        if (selectedValue) {
          await parentSelect.selectOption(selectedValue);
          return;
        }
        throw new Error(`Parent category option not available: ${parentName}`);
      });
    };

    try {
      token = await getAuthToken(request);
      await login(page, 'admin');

      await page.goto('/backend/catalog/categories/create');
      await page.getByRole('textbox', { name: 'e.g., Footwear' }).fill(parentName);
      await page.getByRole('button', { name: 'Create' }).last().click();
      await expect(page).toHaveURL(/\/backend\/catalog\/categories$/);
      await waitForList();

      await page.getByRole('textbox', { name: 'Search categories' }).fill(parentName);
      const parentRow = page.getByRole('row', { name: new RegExp(parentName) });
      await expect(parentRow).toBeVisible();
      await parentRow.getByText(parentName, { exact: true }).first().click();
      await expect(page).toHaveURL(/\/backend\/catalog\/categories\/[0-9a-f-]{36}\/edit$/i);
      parentCategoryId = page.url().match(/\/backend\/catalog\/categories\/([0-9a-f-]{36})\/edit$/i)?.[1] ?? null;

      await page.goto('/backend/catalog/categories/create');
      await page.getByRole('textbox', { name: 'e.g., Footwear' }).fill(childName);
      await selectParent();
      await page.getByRole('button', { name: 'Create' }).last().click();
      await expect(page).toHaveURL(/\/backend\/catalog\/categories$/);
      await waitForList();

      await page.getByRole('textbox', { name: 'Search categories' }).fill(childName);
      const childRow = page.getByRole('row', { name: new RegExp(childName) }).first();
      await expect(childRow).toBeVisible();
      await childRow.click();
      await expect(page).toHaveURL(/\/backend\/catalog\/categories\/[0-9a-f-]{36}\/edit$/i);
      childCategoryId = page.url().match(/\/backend\/catalog\/categories\/([0-9a-f-]{36})\/edit$/i)?.[1] ?? null;
      if (parentCategoryId) {
        const parentSelect = page.getByRole('combobox').filter({ hasText: /Root level/i }).first();
        await expect(parentSelect).toBeVisible();
        const selectedValue = await parentSelect.inputValue().catch(() => '');
        if (selectedValue) {
          expect(selectedValue).toBe(parentCategoryId);
        } else {
          const selectedLabel = await parentSelect
            .locator('option:checked')
            .first()
            .innerText()
            .catch(() => '');
          expect(selectedLabel).toContain(parentName);
        }
      }
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
