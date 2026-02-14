import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';

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

    await orgSelect.selectOption({ label: 'Acme Corp' });
    await expect(orgSelect).not.toHaveValue('');
  });
});
