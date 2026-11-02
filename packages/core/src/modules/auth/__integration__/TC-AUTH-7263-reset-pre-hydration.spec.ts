import { expect, test } from '@playwright/test';

/**
 * TC-AUTH-7263: the password-reset request form never submits the email through a GET URL,
 * neither before hydration (JavaScript disabled) nor through the normal JavaScript path.
 */
test.describe('TC-AUTH-7263: Password reset request form before hydration', () => {
  test.describe('with JavaScript disabled', () => {
    test.use({ javaScriptEnabled: false });

    test('keeps the submit button disabled and the form on POST', async ({ page }) => {
      await page.goto('/reset');
      const form = page.locator('form');
      await expect(form).toHaveAttribute('method', 'post');
      await expect(form).toHaveAttribute('data-auth-ready', '0');
      await page.locator('input[name="email"]').fill('dast-nojs@example.invalid');
      await expect(page.locator('form button[type="submit"]')).toBeDisabled();
      const leakedRequest = page
        .waitForRequest((request) => request.url().includes('dast-nojs'), { timeout: 2000 })
        .then(() => true, () => false);
      await page.locator('input[name="email"]').press('Enter');
      expect(await leakedRequest).toBe(false);
      expect(page.url()).not.toContain('email=');
    });
  });

  test('submits through the reset API with JavaScript enabled', async ({ page }) => {
    const requestedUrls: string[] = [];
    page.on('request', (request) => requestedUrls.push(request.url()));
    await page.goto('/reset');
    await expect(page.locator('form')).toHaveAttribute('data-auth-ready', '1');
    await page.getByLabel('Email').fill('dast-js@example.invalid');
    const resetResponse = page.waitForResponse(
      (response) => response.url().endsWith('/api/auth/reset') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: /send reset link/i }).click();
    expect((await resetResponse).ok()).toBe(true);
    await expect(page.getByText(/if an account with that email exists/i)).toBeVisible();
    expect(requestedUrls.some((url) => url.includes('dast-js'))).toBe(false);
    expect(page.url()).not.toContain('email=');
  });
});
