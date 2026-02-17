import { expect, test } from '@playwright/test';
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-CAT-011: Configure Product Pricing
 * Source: .ai/qa/scenarios/TC-CAT-011-product-pricing-setup.md
 */
test.describe('TC-CAT-011: Configure Product Pricing', () => {
  test('should set variant sale and regular prices during variant creation', async ({ page, request }) => {
    const productName = `QA TC-CAT-011 ${Date.now()}`;
    const baseSku = `QA-CAT-011-BASE-${Date.now()}`;
    const variantName = `Priced Variant ${Date.now()}`;
    const variantSku = `QA-CAT-011-VAR-${Date.now()}`;
    let token: string | null = null;
    let productId: string | null = null;

    try {
      token = await getAuthToken(request);
      productId = await createProductFixture(request, token, { title: productName, sku: baseSku });

      await login(page, 'admin');
      await page.goto(`/backend/catalog/products/${productId}`);

      await page.getByRole('link', { name: 'Add variant' }).click();
      await expect(page).toHaveURL(/\/variants\/create$/);

      await page.getByRole('textbox', { name: 'e.g., Blue / Small' }).fill(variantName);
      await page.getByRole('textbox', { name: 'Unique identifier' }).fill(variantSku);

      const priceInputs = page.getByRole('textbox', { name: '0.00' });
      await priceInputs.nth(0).fill('19.99');
      await priceInputs.nth(1).fill('24.99');
      await page.getByRole('button', { name: 'Create variant' }).last().click();

      await expect(page).toHaveURL(/\/backend\/catalog\/products\/[0-9a-f-]{36}\/variants\/[0-9a-f-]{36}$/i);
      await expect(priceInputs.nth(0)).toHaveValue('19.9900');
      await expect(priceInputs.nth(1)).toHaveValue('24.9900');
    } finally {
      await deleteCatalogProductIfExists(request, token, productId);
    }
  });
});
