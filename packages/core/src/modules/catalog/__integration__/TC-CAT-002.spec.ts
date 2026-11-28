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
      page.locator('[data-crud-field-id="title"]').getByText('Title is required.', { exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/backend\/catalog\/products\/create$/);
  });

  test('keeps the focused title rejection visible after the form grows', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await login(page, 'admin');
    await page.goto('/backend/catalog/products/create');

    const previous = page.getByRole('button', { name: 'Previous', exact: true });
    const next = page.getByRole('button', { name: 'Continue', exact: true });
    await expect(async () => {
      if (await previous.isDisabled()) await next.click();
      await expect(previous).toBeEnabled({ timeout: 500 });
    }).toPass({ timeout: 5000 });
    await previous.click();
    await expect(previous).toBeDisabled();

    await page.getByRole('button', { name: 'Create product' }).last().click();
    const summary = page.locator('[data-crud-form-error]');
    await expect(summary.getByRole('alert')).toHaveText('Title is required.');
    await expect(summary).toBeFocused();
    const startsInViewport = () => summary.evaluate((element) => {
      const { top } = element.getBoundingClientRect();
      return top >= 0 && top < window.innerHeight;
    });
    await expect.poll(startsInViewport).toBe(true);

    const displaced = await summary.evaluate((element) => {
      const content = element.previousElementSibling;
      if (!(content instanceof HTMLElement)) throw new Error('[internal] Catalog form content is missing');
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        ancestor.style.overflowAnchor = 'none';
      }
      content.style.paddingBlockEnd = `${window.innerHeight * 2}px`;
      return element.getBoundingClientRect().top >= window.innerHeight;
    });
    expect(displaced).toBe(true);
    await expect.poll(startsInViewport).toBe(true);
    await expect(summary).toBeFocused();
    await testInfo.attach('catalog-title-rejection-after-layout-growth', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
});
