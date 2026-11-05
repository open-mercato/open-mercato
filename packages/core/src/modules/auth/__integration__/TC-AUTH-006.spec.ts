import { expect, test } from '@playwright/test';
import { postForm } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * TC-AUTH-006: Complete Password Reset
 * Source: .ai/qa/scenarios/TC-AUTH-006-password-reset-complete.md
 *
 * Covers the scenario's "no password change is possible with an invalid token"
 * expected result, and the page-level half of it after issue #5533: a dead token
 * no longer renders a form the user can waste effort on.
 *
 * The live-token half (form renders → submit → redirect to /login) is NOT driven
 * here. Doing so needs the raw token, whose only test-visible source is the
 * captured reset email, and reading that capture file does not work in the
 * ephemeral lane this suite runs in — the app writes it where the Playwright
 * process cannot see it, and the one other capture-based spec
 * (customer_accounts TC-AUTH-033) is not part of this lane either. That path is
 * covered instead by the component test in
 * `packages/core/src/modules/auth/__tests__/resetWithTokenPage.test.tsx`. Adding
 * a shared email-capture helper that works in the ephemeral lane would let this
 * spec cover the full round trip; that is a follow-up, not a silent gap.
 */
test.describe('TC-AUTH-006: Complete Password Reset', () => {
  test('should refuse to render the form for a token that cannot complete a reset', async ({ page }) => {
    const validated = page.waitForResponse(
      (response) =>
        response.url().includes('/api/auth/reset/validate') &&
        response.request().method() === 'POST',
    );
    await page.goto('/reset/qa-invalid-token');
    await validated;

    await expect(page.locator('[data-auth-token-state="expired"]')).toBeVisible();
    await expect(page.getByText(/this reset link is no longer valid/i)).toBeVisible();
    await expect(page.getByLabel(/^new password$/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /update password/i })).toHaveCount(0);
  });

  test('should reject a completion attempt that replays an invalid token straight at the API', async ({ request }) => {
    const response = await postForm(request, '/api/auth/reset/confirm', {
      token: 'qa-invalid-token',
      password: 'Valid1!Pass',
    });

    expect(response.status(), 'confirm must reject a dead token server-side').toBe(400);
    const body = (await response.json()) as { ok?: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/invalid or expired token/i);
  });

  test('should report an unusable token without consuming it or leaking why it is unusable', async ({ request }) => {
    const first = await postForm(request, '/api/auth/reset/validate', { token: 'qa-invalid-token' });
    expect(first.status()).toBe(200);
    const firstBody = (await first.json()) as Record<string, unknown>;
    expect(firstBody).toEqual({ ok: true, valid: false });

    // Re-checking must give the identical answer: the check is read-only, so it
    // can never be the thing that burns a token.
    const second = await postForm(request, '/api/auth/reset/validate', { token: 'qa-invalid-token' });
    const secondBody = (await second.json()) as Record<string, unknown>;
    expect(secondBody).toEqual(firstBody);
  });
});
