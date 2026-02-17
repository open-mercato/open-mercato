import { expect, test } from '@playwright/test';
import { login } from '../../core/__integration__/helpers/auth';

/**
 * TC-AUTH-014: Organization Switching
 * Source: .ai/qa/scenarios/TC-AUTH-014-organization-switching.md
 */
test.describe('TC-AUTH-014: Organization Switching', () => {
  test('should allow switching organization context from the header selector', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/backend/users');

    const orgSelect = page.getByRole('combobox').first();
    await expect(orgSelect).toBeVisible();
    await orgSelect.selectOption({ label: 'All organizations' });
    await expect(orgSelect).toHaveValue('');

    const orgValue = await orgSelect.evaluate((element) => {
      const select = element as HTMLSelectElement;
      for (const option of Array.from(select.options)) {
        if (option.value && option.value.trim().length > 0) return option.value;
      }
      return '';
    });
    if (!orgValue) {
      test.skip(true, 'No scoped organizations available to switch to.');
    }
    await orgSelect.selectOption(orgValue);
    await expect(orgSelect).toHaveValue(orgValue);
  });
});
