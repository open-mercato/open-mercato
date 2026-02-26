import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-CAT-002: Product Creation Validation Errors
 * Source: .ai/qa/scenarios/TC-CAT-002-product-creation-validation.md
 */
test.describe('TC-CAT-002: Product Creation Validation Errors', () => {
  test('should block save when required title is missing', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/backend/catalog/products/create');

    await page.getByRole('button', { name: 'Create product' }).last().click();

    await expect(
      page.locator('p.text-red-600', { hasText: 'catalog.products.validation.titleRequired' }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/backend\/catalog\/products\/create$/);
  });
});
