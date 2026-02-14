import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';

/**
 * TC-CAT-012: Product Search and Filter
 * Source: .ai/qa/scenarios/TC-CAT-012-product-search-filter.md
 */
test.describe('TC-CAT-012: Product Search and Filter', () => {
  test('should search products by name and SKU', async ({ page }) => {
    const productName = 'Atlas Runner Sneaker';
    const sku = 'ATLAS-RUNNER';

    await login(page, 'admin');
    await page.goto('/backend/catalog/products');
    const search = page.getByRole('textbox', { name: 'Search' });

    await search.fill(productName);
    await expect(page.getByText(productName).first()).toBeVisible({ timeout: 10_000 });

    await search.fill(sku);
    await expect(page.getByText(productName).first()).toBeVisible({ timeout: 10_000 });
  });
});
