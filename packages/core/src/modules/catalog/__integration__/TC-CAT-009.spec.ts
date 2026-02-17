import { expect, test } from '@playwright/test';
import { createProductFixture, deleteCatalogProductIfExists } from './helpers/catalogFixtures';
import { getAuthToken } from './helpers/api';
import { login } from './helpers/auth';

/**
 * TC-CAT-009: Product Tag Management
 * Source: .ai/qa/scenarios/TC-CAT-009-tag-management.md
 */
test.describe('TC-CAT-009: Product Tag Management', () => {
  test('should add tags to product and keep them after save', async ({ page, request }) => {
    const productName = `QA TC-CAT-009 ${Date.now()}`;
    const sku = `QA-CAT-009-${Date.now()}`;
    const tagOne = `qa-tag-${Date.now()}`;
    const tagTwo = `qa-segment-${Date.now()}`;
    let token: string | null = null;
    let productId: string | null = null;

    try {
      token = await getAuthToken(request);
      productId = await createProductFixture(request, token, { title: productName, sku });

      await login(page, 'admin');
      await page.goto(`/backend/catalog/products/${productId}`);

      const tagsInput = page.getByRole('textbox', { name: 'Add tag and press Enter' });
      await tagsInput.fill(tagOne);
      await tagsInput.press('Enter');
      await tagsInput.fill(tagTwo);
      await tagsInput.press('Enter');
      await page.getByRole('button', { name: 'Save changes' }).last().click();

      await expect(page.getByText(tagOne, { exact: true })).toBeVisible();
      await expect(page.getByText(tagTwo, { exact: true })).toBeVisible();
    } finally {
      await deleteCatalogProductIfExists(request, token, productId);
    }
  });
});
