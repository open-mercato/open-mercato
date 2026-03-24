import { expect, test } from '@playwright/test';
import {
  createProductFixture,
  createVariantFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-CAT-006: Edit Product Variant
 * Source: .ai/qa/scenarios/TC-CAT-006-product-variant-edit.md
 */
test.describe('TC-CAT-006: Edit Product Variant', () => {
  test('should edit default variant SKU and persist change', async ({ page, request }) => {
    test.slow();
    const productName = `QA TC-CAT-006 ${Date.now()}`;
    const baseSku = `QA-CAT-006-BASE-${Date.now()}`;
    const variantName = `Editable Variant ${Date.now()}`;
    const variantSku = `QA-CAT-006-VAR-${Date.now()}`;
    const updatedSku = `QA-CAT-006-UPD-${Date.now()}`;
    let token: string | null = null;
    let productId: string | null = null;
    let variantId: string | null = null;

    try {
      token = await getAuthToken(request);
      productId = await createProductFixture(request, token, { title: productName, sku: baseSku });
      variantId = await createVariantFixture(request, token, {
        productId,
        name: variantName,
        sku: variantSku,
      });

      await login(page, 'admin');
      await page.goto(`/backend/catalog/products/${productId}`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('link', { name: 'Edit' }).first().click();
      await expect(page).toHaveURL(new RegExp(`/backend/catalog/products/${productId}/variants/${variantId}$`));

      await page.getByRole('textbox', { name: 'Unique identifier' }).fill(updatedSku);
      await page.getByRole('button', { name: 'Save changes' }).last().click();

      await expect(page.getByText(updatedSku, { exact: true })).toBeVisible();
    } finally {
      await deleteCatalogProductIfExists(request, token, productId);
    }
  });
});
