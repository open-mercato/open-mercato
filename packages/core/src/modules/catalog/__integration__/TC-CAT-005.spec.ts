import { expect, test } from '@playwright/test';
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-CAT-005: Create Product Variant
 * Source: .ai/qa/scenarios/TC-CAT-005-product-variant-creation.md
 */
test.describe('TC-CAT-005: Create Product Variant', () => {
  test('should create an additional variant for a product', async ({ page, request }) => {
    const productName = `QA TC-CAT-005 ${Date.now()}`;
    const baseSku = `QA-CAT-005-BASE-${Date.now()}`;
    const variantName = `Blue / 42 ${Date.now()}`;
    const variantSku = `QA-CAT-005-VAR-${Date.now()}`;
    let token: string | null = null;
    let productId: string | null = null;

    try {
      token = await getAuthToken(request);
      productId = await createProductFixture(request, token, { title: productName, sku: baseSku });

      await login(page, 'admin');
      await page.goto(`/backend/catalog/products/${productId}/variants/create`);
      await expect(page).toHaveURL(/\/variants\/create$/);
      await page.getByRole('textbox', { name: 'e.g., Blue / Small' }).fill(variantName);
      await page.getByRole('textbox', { name: 'Unique identifier' }).fill(variantSku);
      await page.getByRole('button', { name: 'Create variant' }).last().click();

      await expect(page).toHaveURL(/\/backend\/catalog\/products\/[0-9a-f-]{36}\/variants\/[0-9a-f-]{36}$/i);
      await expect(page.getByRole('textbox', { name: 'e.g., Blue / Small' })).toHaveValue(variantName);
      await expect(page.getByRole('textbox', { name: 'Unique identifier' })).toHaveValue(variantSku);
    } finally {
      await deleteCatalogProductIfExists(request, token, productId);
    }
  });
});
