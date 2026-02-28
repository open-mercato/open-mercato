import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures';
import { createSalesDocument } from '@open-mercato/core/modules/core/__integration__/helpers/salesUi';

/**
 * TC-INT-003: Product Creation to Sales Channel to Order
 * Source: .ai/qa/scenarios/TC-INT-003-product-to-sales-flow.md
 */
test.describe('TC-INT-003: Product Creation to Sales Channel to Order', () => {
  test('should create a product and proceed with order creation flow', async ({ page, request }) => {
    const stamp = Date.now();
    const productName = `QA INT-003 Product ${stamp}`;
    const sku = `QA-INT-003-${stamp}`;
    let token: string | null = null;
    let productId: string | null = null;

    try {
      token = await getAuthToken(request);
      productId = await createProductFixture(request, token, { title: productName, sku });

      await login(page, 'admin');
      await page.goto(`/backend/catalog/products/${productId}`);
      await expect(page).toHaveURL(new RegExp(`/backend/catalog/products/${productId}$`, 'i'));

      await createSalesDocument(page, { kind: 'order' });
      await expect(page).toHaveURL(/kind=order$/i);
    } finally {
      await deleteCatalogProductIfExists(request, token, productId);
    }
  });
});
