import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-CAT-001: Create New Product
 * Source: .ai/qa/scenarios/TC-CAT-001-product-creation.md
 */
test.describe('TC-CAT-001: Create New Product', () => {
  test('should create a product from catalog create form', async ({ page }) => {
    const productName = `QA TC-CAT-001 ${Date.now()}`;
    const sku = `QA-CAT-001-${Date.now()}`;

    await login(page, 'admin');
    await page.goto('/backend/catalog/products/create');

    await page.getByRole('textbox', { name: 'e.g., Summer sneaker' }).fill(productName);
    await page
      .getByRole('textbox', { name: 'Describe the product...' })
      .fill('This is a catalog QA description long enough to satisfy SEO validation checks in create flow.');

    await page.getByRole('button', { name: 'Variants' }).click();
    await page.getByRole('textbox', { name: 'e.g., SKU-001' }).fill(sku);

    const createProductButton = page
      .locator('button[type="submit"]')
      .filter({ hasText: /^Create product$|catalog\.products\.actions\.create/i })
      .first();
    await expect(createProductButton).toBeEnabled();
    await createProductButton.click();

    await expect(page).toHaveURL(/\/backend\/catalog\/products\/[^/?#]+$/i, { timeout: 10_000 });
    const createdProductId = page.url().split('/').at(-1) ?? '';
    expect(createdProductId.length > 0).toBe(true);
  });
});
