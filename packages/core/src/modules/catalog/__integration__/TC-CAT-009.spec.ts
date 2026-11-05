import { expect, test } from '@playwright/test';
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-CAT-009: Product Tag Management
 * Source: .ai/qa/scenarios/TC-CAT-009-tag-management.md
 */
test.describe('TC-CAT-009: Product Tag Management', () => {
  test('should add tags to product and keep them after save', async ({ page, request }) => {
    const productName = `QA TC-CAT-009 ${Date.now()}`;
    const sku = `QA-CAT-009-${Date.now()}`;
    const tagOne = `qa-tag-${Date.now()}`;
    const tagTwo = `qa-segment-${Date.now()}`;
    let token: string | null = null;
    let productId: string | null = null;

    try {
      token = await getAuthToken(request);
      productId = await createProductFixture(request, token, { title: productName, sku });

      await login(page, 'admin');
      await page.goto(`/backend/catalog/products/${productId}`);

      const tagsInput = page.getByRole('textbox', { name: 'Add tag and press Enter' });

      // TagsInput commits the typed tag on Enter by reading the controlled `input`
      // state from the keydown closure. fill() + an immediate press('Enter') can run
      // that handler before React has committed the new value, so the keypress adds
      // an empty value (no-op) while still clearing the box. Retry the type+Enter
      // until the chip actually renders; re-adding an existing tag is a no-op.
      const addTagChip = async (tag: string) => {
        await expect(async () => {
          await tagsInput.fill(tag);
          await tagsInput.press('Enter');
          await expect(page.getByText(tag, { exact: true })).toBeVisible({ timeout: 2_000 });
        }).toPass({ timeout: 15_000 });
      };

      await addTagChip(tagOne);
      await addTagChip(tagTwo);
      await page.getByRole('button', { name: 'Save changes' }).last().click();

      await expect(page.getByText(tagOne, { exact: true })).toBeVisible();
      await expect(page.getByText(tagTwo, { exact: true })).toBeVisible();
    } finally {
      await deleteCatalogProductIfExists(request, token, productId);
    }
  });
});
