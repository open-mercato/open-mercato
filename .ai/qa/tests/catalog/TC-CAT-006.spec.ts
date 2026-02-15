import { expect, test } from '@playwright/test';
import { createProductFixture, deleteCatalogProductIfExists } from '../helpers/catalogFixtures';
import { getAuthToken } from '../helpers/api';
import { login } from '../helpers/auth';

/**
 * TC-CAT-006: Edit Product Variant
 * Source: .ai/qa/scenarios/TC-CAT-006-product-variant-edit.md
 */
test.describe('TC-CAT-006: Edit Product Variant', () => {
  test('should edit default variant SKU and persist change', async ({ page, request }) => {
    const productName = `QA TC-CAT-006 ${Date.now()}`;
    const baseSku = `QA-CAT-006-BASE-${Date.now()}`;
    const updatedSku = `QA-CAT-006-UPD-${Date.now()}`;
    let token: string | null = null;
    let productId: string | null = null;

    try {
      token = await getAuthToken(request);
      productId = await createProductFixture(request, token, { title: productName, sku: baseSku });

      await login(page, 'admin');
      await page.goto(`/backend/catalog/products/${productId}`);

      await page.getByRole('link', { name: 'Add variant' }).click();
      await expect(page).toHaveURL(/\/variants\/create$/);
      await page.getByRole('textbox', { name: 'e.g., Blue / Small' }).fill('Editable Variant');
      await page.getByRole('textbox', { name: 'Unique identifier' }).fill(baseSku);
      await page.getByRole('button', { name: 'Create variant' }).last().click();
      await expect(page).toHaveURL(/\/variants\/[0-9a-f-]{36}$/i);

      await page.getByRole('textbox', { name: 'Unique identifier' }).fill(updatedSku);
      await page.getByRole('button', { name: 'Save changes' }).last().click();

      await expect(page.getByText(updatedSku, { exact: true })).toBeVisible();
    } finally {
      await deleteCatalogProductIfExists(request, token, productId);
    }
  });
});
