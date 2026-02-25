import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures';

/**
 * TC-CAT-003: Edit Existing Product
 * Source: .ai/qa/scenarios/TC-CAT-003-product-edit.md
 */
test.describe('TC-CAT-003: Edit Existing Product', () => {
  test('should edit product title and persist it', async ({ page, request }) => {
    const productName = `QA TC-CAT-003 ${Date.now()}`;
    const updatedName = `${productName} Updated`;
    const sku = `QA-CAT-003-${Date.now()}`;
    let token: string | null = null;
    let productId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');
      productId = await createProductFixture(request, token, { title: productName, sku });

      await login(page, 'admin');
      await page.goto(`/backend/catalog/products/${productId}`);
      await expect(page.getByText('Product not found.')).toHaveCount(0);

      const titleField = page.getByRole('textbox', { name: 'e.g., Summer sneaker' });
      await titleField.fill(updatedName);
      await page.getByRole('button', { name: 'Save changes' }).last().click();
      await expect(page.getByTestId('widget-transform-form-data')).toContainText(`"title":"${updatedName}"`);
    } finally {
      await deleteCatalogProductIfExists(request, token, productId);
    }
  });
});
