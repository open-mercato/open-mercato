import { expect, test } from '@playwright/test';
import { createProductFixture, deleteCatalogProductIfExists } from '../../core/__integration__/helpers/catalogFixtures';
import { getAuthToken } from '../../core/__integration__/helpers/api';
import { login } from '../../core/__integration__/helpers/auth';

/**
 * TC-CAT-004: Delete Product
 * Source: .ai/qa/scenarios/TC-CAT-004-product-delete.md
 */
test.describe('TC-CAT-004: Delete Product', () => {
  test('should open delete confirmation for the default variant', async ({ page, request }) => {
    const productName = `QA TC-CAT-004 ${Date.now()}`;
    const sku = `QA-CAT-004-BASE-${Date.now()}`;
    let token: string | null = null;
    let productId: string | null = null;

    try {
      token = await getAuthToken(request);
      productId = await createProductFixture(request, token, { title: productName, sku });

      await login(page, 'admin');
      await page.goto(`/backend/catalog/products/${productId}`);

      await page.getByRole('link', { name: 'Add variant' }).click();
      await expect(page).toHaveURL(/\/variants\/create$/);
      await page.getByRole('textbox', { name: 'e.g., Blue / Small' }).fill('Delete Me Variant');
      await page.getByRole('textbox', { name: 'Unique identifier' }).fill(`QA-CAT-004-VAR-${Date.now()}`);
      await page.getByRole('button', { name: 'Create variant' }).last().click();
      await expect(page).toHaveURL(/\/variants\/[0-9a-f-]{36}$/i);

      await page.goto(`/backend/catalog/products/${productId}`);
      await page.getByRole('button', { name: /^Delete$/i }).first().click();
      const confirmDialog = page.getByRole('alertdialog');
      await expect(confirmDialog).toBeVisible();
      await expect(confirmDialog.getByRole('heading', { name: /Delete variant/i })).toBeVisible();
      await expect(confirmDialog.getByRole('button', { name: 'Confirm' })).toBeVisible();
    } finally {
      await deleteCatalogProductIfExists(request, token, productId);
    }
  });
});
