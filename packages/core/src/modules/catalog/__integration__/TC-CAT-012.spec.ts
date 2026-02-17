import { expect, test } from '@playwright/test';
import { createProductFixture, deleteCatalogProductIfExists } from './helpers/catalogFixtures';
import { getAuthToken } from './helpers/api';
import { login } from './helpers/auth';

/**
 * TC-CAT-012: Product Search and Filter
 * Source: .ai/qa/scenarios/TC-CAT-012-product-search-filter.md
 */
test.describe('TC-CAT-012: Product Search and Filter', () => {
  test('should search products by name and SKU', async ({ page, request }) => {
    const stamp = Date.now();
    const productName = `QA TC-CAT-012 ${stamp}`;
    const sku = `QA-CAT-012-${stamp}`;
    let token: string | null = null;
    let productId: string | null = null;

    try {
      token = await getAuthToken(request);
      productId = await createProductFixture(request, token, { title: productName, sku });

      await login(page, 'admin');
      await page.goto('/backend/catalog/products');
      const search = page.getByRole('textbox', { name: 'Search' });

      await search.fill(productName);
      await expect(page.getByText(productName).first()).toBeVisible({ timeout: 10_000 });

      await search.fill(sku);
      await expect(page.getByText(productName).first()).toBeVisible({ timeout: 10_000 });
    } finally {
      await deleteCatalogProductIfExists(request, token, productId);
    }
  });
});
