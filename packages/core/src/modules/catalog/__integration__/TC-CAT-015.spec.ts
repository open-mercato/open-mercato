import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import {
  createCategoryFixture,
  deleteCatalogCategoryIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * TC-CAT-015: Organize Step Keeps Human-Readable Labels After Step Navigation
 */
test.describe('TC-CAT-015: Organize Step Keeps Human-Readable Labels After Step Navigation', () => {
  test('should keep category and sales channel labels after Continue -> Previous', async ({ page, request }) => {
    const base = Date.now();
    const categoryName = `QA TC-CAT-015 Category ${base}`;
    const channelName = `QA TC-CAT-015 Channel ${base}`;
    const channelCode = `qa-cat-015-${base}`;
    let token: string | null = null;
    let categoryId: string | null = null;
    let channelId: string | null = null;

    try {
      token = await getAuthToken(request);
      categoryId = await createCategoryFixture(request, token, { name: categoryName });

      const channelResponse = await apiRequest(request, 'POST', '/api/sales/channels', {
        token,
        data: {
          name: channelName,
          code: channelCode,
        },
      });
      expect(channelResponse.ok(), `Failed to create sales channel fixture: ${channelResponse.status()}`).toBeTruthy();
      const channelBody = (await channelResponse.json()) as { id?: string };
      channelId = typeof channelBody.id === 'string' ? channelBody.id : null;
      expect(channelId, 'Missing sales channel id').toBeTruthy();

      await login(page, 'admin');
      await page.goto('/backend/catalog/products');

      const organizationSelect = page.getByRole('combobox').first();
      await expect(organizationSelect).toBeVisible();
      const selectedOrgValue = await organizationSelect.inputValue();
      if (!selectedOrgValue) {
        const scopedOrgValue = await organizationSelect.evaluate((element) => {
          const select = element as HTMLSelectElement;
          for (const option of Array.from(select.options)) {
            if (option.value && option.value.trim().length > 0) return option.value;
          }
          return '';
        });
        if (scopedOrgValue) {
          await organizationSelect.selectOption(scopedOrgValue);
        }
      }

      await page.goto('/backend/catalog/products/create');

      const productTitle = `QA TC-CAT-015 Product ${base}`;
      const titleInput = page.getByRole('textbox', { name: 'e.g., Summer sneaker' });
      for (let attempt = 0; attempt < 3; attempt++) {
        await titleInput.fill(productTitle);
        const currentValue = await titleInput.inputValue();
        if (currentValue === productTitle) break;
        await page.waitForTimeout(150);
      }
      await expect(titleInput).toHaveValue(productTitle);
      await page.getByRole('textbox', { name: 'Describe the product...' }).fill(
        'QA TC-CAT-015 regression check for organize labels after step navigation.',
      );

      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page.getByPlaceholder('Search categories')).toBeVisible();

      const categoriesInput = page.getByPlaceholder('Search categories');
      await categoriesInput.fill(categoryName);
      await page.getByRole('button', { name: new RegExp(categoryName, 'i') }).first().click();

      const channelsInput = page.getByPlaceholder('Pick channels');
      await channelsInput.fill(channelName);
      await page.getByRole('button', { name: new RegExp(channelName, 'i') }).first().click();

      const categoriesSection = categoriesInput.locator('xpath=ancestor::div[contains(@class,"space-y-2")][1]');
      const channelsSection = channelsInput.locator('xpath=ancestor::div[contains(@class,"space-y-2")][1]');

      await expect(categoriesSection).toContainText(categoryName);
      await expect(channelsSection).toContainText(channelName);

      await page.getByRole('button', { name: 'Continue' }).click();
      if (await page.getByPlaceholder('Search categories').isVisible()) {
        await page.getByRole('button', { name: 'Variants' }).click();
      }
      await expect(page.getByRole('columnheader', { name: 'Default option' })).toBeVisible();
      await page.getByRole('button', { name: 'Previous' }).click();
      await expect(page.getByPlaceholder('Search categories')).toBeVisible();

      await expect(categoriesSection).toContainText(categoryName);
      await expect(channelsSection).toContainText(channelName);
      if (categoryId) {
        await expect(categoriesSection).not.toContainText(categoryId);
      }
      if (channelId) {
        await expect(channelsSection).not.toContainText(channelId);
      }
    } finally {
      if (token && channelId) {
        await apiRequest(request, 'DELETE', `/api/sales/channels?id=${encodeURIComponent(channelId)}`, { token }).catch(() => {});
      }
      await deleteCatalogCategoryIfExists(request, token, categoryId);
    }
  });
});
