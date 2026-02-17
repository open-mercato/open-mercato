import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { deleteCatalogProductIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures';
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
      await login(page, 'admin');
      await page.goto('/backend/catalog/products/create');
      await page.getByRole('textbox', { name: 'e.g., Summer sneaker' }).fill(productName);
      await page.getByRole('textbox', { name: 'Describe the product...' }).fill('INT-003 product created for integration coverage.');
      await page.getByRole('button', { name: 'Variants' }).click();
      await page.getByRole('textbox', { name: 'e.g., SKU-001' }).fill(sku);
      await page.getByRole('button', { name: 'Create product' }).last().click();
      await expect(page).toHaveURL(/\/backend\/catalog\/products$/);

      await page.getByRole('textbox', { name: 'Search' }).fill(productName);
      const productRow = page.getByRole('row', { name: new RegExp(productName) }).first();
      await expect(productRow).toBeVisible();
      await productRow.click();
      await expect(page).toHaveURL(/\/backend\/catalog\/products\/[0-9a-f-]{36}$/i);
      productId = page.url().match(/\/backend\/catalog\/products\/([0-9a-f-]{36})$/i)?.[1] ?? null;

      await createSalesDocument(page, { kind: 'order' });
      await expect(page).toHaveURL(/kind=order$/i);
    } finally {
      await deleteCatalogProductIfExists(request, token, productId);
    }
  });
});
