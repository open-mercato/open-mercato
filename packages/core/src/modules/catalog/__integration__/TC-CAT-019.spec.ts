import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-CAT-019: Product Create Requires Specific Organization Context
 */
test.describe('TC-CAT-019: Product Create Requires Specific Organization Context', () => {
  test('should block submit while organization scope is All organizations', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/backend/catalog/products');

    const organizationSelect = page.getByRole('combobox').first();
    await expect(organizationSelect).toBeVisible();
    await organizationSelect.selectOption({ label: 'All organizations' });
    await expect(organizationSelect).toHaveValue('');

    await page.goto('/backend/catalog/products/create');
    await page.getByRole('textbox', { name: 'e.g., Summer sneaker' }).fill(`QA TC-CAT-019 ${Date.now()}`);
    await page.getByRole('textbox', { name: 'Describe the product...' }).fill(
      'QA TC-CAT-019 exploratory regression check for organization scope.',
    );
    await page.getByRole('button', { name: 'Variants' }).click();
    await page.getByRole('textbox', { name: 'e.g., SKU-001' }).fill(`QA-CAT-019-${Date.now()}`);

    let productCreatePostCount = 0;
    await page.route('**/api/catalog/products**', async (route) => {
      if (route.request().method() === 'POST') {
        productCreatePostCount += 1;
      }
      await route.continue();
    });

    await page.getByRole('button', { name: 'Create product' }).last().click();
    await page.waitForLoadState('networkidle');

    expect(productCreatePostCount).toBe(0);
  });
});

