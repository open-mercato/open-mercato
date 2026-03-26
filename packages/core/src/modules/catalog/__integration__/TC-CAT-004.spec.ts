import { expect, test } from '@playwright/test';
import {
  createProductFixture,
  createVariantFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-CAT-004: Delete Product
 * Source: .ai/qa/scenarios/TC-CAT-004-product-delete.md
 */
test.describe('TC-CAT-004: Delete Product', () => {
  test('should open delete confirmation for the default variant', async ({ page, request }) => {
    test.slow();
    const productName = `QA TC-CAT-004 ${Date.now()}`;
    const sku = `QA-CAT-004-BASE-${Date.now()}`;
    const variantName = `Delete Me Variant ${Date.now()}`;
    const variantSku = `QA-CAT-004-VAR-${Date.now()}`;
    let token: string | null = null;
    let productId: string | null = null;

    try {
      token = await getAuthToken(request);
      productId = await createProductFixture(request, token, { title: productName, sku });
      await createVariantFixture(request, token, {
        productId,
        name: variantName,
        sku: variantSku,
        isDefault: true,
      });

      await login(page, 'admin');
      await page.goto(`/backend/catalog/products/${productId}`, { waitUntil: 'domcontentloaded' });
      const variantRow = page.getByRole('row').filter({ hasText: variantName });
      await expect(variantRow).toBeVisible();
      await variantRow.getByRole('button', { name: /^Delete$/i }).click();
      const confirmDialog = page.getByRole('alertdialog');
      await expect(confirmDialog).toBeVisible();
      await expect(confirmDialog.getByRole('heading', { name: /Delete variant/i })).toBeVisible();
      await expect(confirmDialog.getByRole('button', { name: 'Confirm' })).toBeVisible();
    } finally {
      await deleteCatalogProductIfExists(request, token, productId);
    }
  });
});
