import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';

/**
 * TC-AUTH-009: User Creation Validation Errors
 * Source: .ai/qa/scenarios/TC-AUTH-009-user-creation-validation.md
 */
test.describe('TC-AUTH-009: User Creation Validation Errors', () => {
  test('should show validation errors for invalid create payload', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/backend/users/create');

    await page.getByRole('textbox').nth(0).fill(`qa-auth-009-${Date.now()}@acme.com`);
    await page.getByRole('textbox').nth(1).fill('Valid1!Pass');
    const rolesInput = page.getByRole('textbox', { name: /add tag and press enter/i });
    await rolesInput.fill('employee');
    await rolesInput.press('Enter');
    await page.getByRole('button', { name: 'Create' }).first().click();

    await expect(page.getByText(/expected string, received null/i).first()).toBeVisible();
  });
});
