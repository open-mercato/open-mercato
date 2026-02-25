import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-CAT-018: Category Create Requires Specific Organization Context
 * Source: .ai/qa/scenarios/TC-CAT-018-category-create-requires-specific-organization.md
 */
test.describe('TC-CAT-018: Category Create Requires Specific Organization Context', () => {
  test('should block submit while organization scope is All organizations', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/backend/catalog/categories');

    const organizationSelect = page.getByRole('combobox').first();
    await expect(organizationSelect).toBeVisible();
    await organizationSelect.selectOption({ label: 'All organizations' });
    await expect(organizationSelect).toHaveValue('');

    await page.goto('/backend/catalog/categories/create');
    await page.getByRole('textbox', { name: 'e.g., Footwear' }).fill(`QA TC-CAT-018 ${Date.now()}`);

    let categoryCreatePostCount = 0;
    await page.route('**/api/catalog/categories**', async (route) => {
      if (route.request().method() === 'POST') {
        categoryCreatePostCount += 1;
      }
      await route.continue();
    });

    await page.getByRole('button', { name: 'Create' }).last().click();
    await page.waitForLoadState('networkidle');

    expect(categoryCreatePostCount).toBe(0);
  });
});

