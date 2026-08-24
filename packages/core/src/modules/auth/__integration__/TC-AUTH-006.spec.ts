import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getAuthToken, postForm } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { createUserFixture, deleteUserIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures';
import { getTokenContext } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';

type CapturedEmail = {
  to?: string;
  subject?: string;
  links?: string[];
};

const EMAIL_CAPTURE_PATH = process.env.OM_TEST_EMAIL_CAPTURE_PATH?.trim() || join(process.cwd(), '.ai', 'qa', 'email-capture.jsonl');

async function readCapturedEmails(): Promise<CapturedEmail[]> {
  try {
    const raw = await readFile(EMAIL_CAPTURE_PATH, 'utf8');
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as CapturedEmail);
  } catch {
    return [];
  }
}

async function waitForResetToken(to: string): Promise<string> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const link = (await readCapturedEmails())
      .reverse()
      .find((entry) => entry.to?.toLowerCase() === to.toLowerCase())
      ?.links?.find((candidate) => /\/reset\/[^/]+$/.test(candidate));
    if (link) return new URL(link).pathname.split('/').pop()!;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for a captured password reset email to ${to}`);
}

async function openResetPage(page: Page, token: string): Promise<void> {
  const validated = page.waitForResponse(
    (response) =>
      response.url().includes('/api/auth/reset/validate') &&
      response.request().method() === 'POST',
  );
  await page.goto(`/reset/${token}`);
  await validated;
}

/**
 * TC-AUTH-006: Complete Password Reset
 * Source: .ai/qa/scenarios/TC-AUTH-006-password-reset-complete.md
 *
 * Drives the real token out of the captured reset email so both halves of the
 * flow are covered against a live token: a usable link still renders the form
 * and completes, and replaying the now-consumed link renders the terminal state
 * instead of a form that can only fail on submit (issue #5533).
 */
test.describe('TC-AUTH-006: Complete Password Reset', () => {
  test('should complete a reset with a live token and refuse to re-render the form for the consumed one', async ({ page, request }) => {
    test.slow();

    const stamp = Date.now();
    const email = `qa-auth-006-${stamp}@acme.com`;
    const newPassword = `Valid1!Pass${stamp}`;
    let token: string | null = null;
    let userId: string | null = null;

    try {
      token = await getAuthToken(request);
      const { organizationId } = getTokenContext(token);
      userId = await createUserFixture(request, token, {
        email,
        name: 'QA Auth 006',
        password: 'Valid1!Pass',
        organizationId,
        roles: ['employee'],
      });

      const resetRes = await postForm(request, '/api/auth/reset', { email });
      expect(resetRes.ok(), 'reset request should be accepted').toBeTruthy();

      const resetToken = await waitForResetToken(email);

      await openResetPage(page, resetToken);
      await expect(page.getByText(/set a new password/i)).toBeVisible();
      await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible', timeout: 30_000 });

      await page.getByLabel(/^new password$/i).fill(newPassword);
      await page.getByLabel(/^confirm new password$/i).fill(newPassword);
      const confirmed = page.waitForResponse(
        (response) =>
          response.url().includes('/api/auth/reset/confirm') &&
          response.request().method() === 'POST',
      );
      await page.getByRole('button', { name: /update password/i }).click();
      expect((await confirmed).status(), 'confirm should accept the live token').toBe(200);
      await expect(page).toHaveURL(/\/login$/);

      await openResetPage(page, resetToken);
      await expect(page.locator('[data-auth-token-state="expired"]')).toBeVisible();
      await expect(page.getByText(/this reset link is no longer valid/i)).toBeVisible();
      await expect(page.getByLabel(/^new password$/i)).toHaveCount(0);
    } finally {
      await deleteUserIfExists(request, token, userId);
    }
  });
});
