import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-CAT-003: Edit Existing Product
 * Source: .ai/qa/scenarios/TC-CAT-003-product-edit.md
 */
test.describe('TC-CAT-003: Edit Existing Product', () => {
  test('should edit product title and persist it', async ({ page }) => {
    const productName = `QA TC-CAT-003 ${Date.now()}`;
    const updatedName = `${productName} Updated`;
    const sku = `QA-CAT-003-${Date.now()}`;

    await login(page, 'admin');
    await page.goto('/backend/catalog/products/create');
    await page.getByRole('textbox', { name: 'e.g., Summer sneaker' }).fill(productName);
    await page
      .getByRole('textbox', { name: 'Describe the product...' })
      .fill('This is a catalog QA description long enough to satisfy SEO validation checks in create flow.');
    await page.getByRole('button', { name: 'Variants' }).click();
    await page.getByRole('textbox', { name: 'e.g., SKU-001' }).fill(sku);
    const createResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        /\/api\/catalog\/products(?:\?|$)/.test(response.url()) &&
        response.ok(),
      { timeout: 10_000 },
    );
    await page.getByRole('button', { name: 'Create product' }).last().click();
    const createResponse = await createResponsePromise;
    const createBody = (await createResponse.json().catch(() => null)) as { id?: unknown } | null;
    const createdProductId = typeof createBody?.id === 'string' ? createBody.id : null;
    await page.goto('/backend/catalog/products');
    const search = page.getByRole('textbox', { name: 'Search' });
    if (createdProductId) {
      await page.goto(`/backend/catalog/products/${createdProductId}`);
    } else {
      await search.fill(productName);
      await page.getByText(productName, { exact: true }).first().click();
    }

    await expect(page).toHaveURL(/\/backend\/catalog\/products\/[0-9a-f-]{36}$/i);
    const titleField = page.getByRole('textbox', { name: 'e.g., Summer sneaker' });
    await titleField.fill(updatedName);
    await page.getByRole('button', { name: 'Save changes' }).last().click();

    await expect(page).toHaveURL(/\/backend\/catalog\/products$/);
    await search.fill(updatedName);
    await expect(page.getByText(updatedName, { exact: true })).toBeVisible();
  });
});
