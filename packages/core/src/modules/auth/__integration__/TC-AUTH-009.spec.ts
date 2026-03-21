import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-AUTH-009: User Creation Validation Errors
 * Source: .ai/qa/scenarios/TC-AUTH-009-user-creation-validation.md
 */
test.describe('TC-AUTH-009: User Creation Validation Errors', () => {
  test('should show validation errors for invalid create payload', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/backend/users/create');
    await expect(page.getByText('Create User')).toBeVisible();

    const emailInput = page.getByRole('textbox').first();
    const passwordInput = page.getByRole('textbox').nth(1);
    await expect(emailInput).toBeVisible();
    await expect(passwordInput).toBeVisible();
    await emailInput.fill(`qa-auth-009-${Date.now()}@acme.com`);
    await passwordInput.fill('Valid1!Pass');
    const rolesInput = page.getByRole('textbox', { name: /add tag and press enter/i });
    await rolesInput.fill('employee');
    await rolesInput.press('Enter');

    await page.getByText('Loading data…').waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
    await page.getByText('Loading widgets…').waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});

    await page.getByRole('button', { name: 'Create' }).first().click();

    await expect(page).toHaveURL(/\/backend\/users\/create/);
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.locator('#organizationId')).toBeFocused();
  });
});
