import { createHash, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures';

export const integrationMeta = {
  dependsOnModules: ['onboarding'],
  requiredEnvVars: ['SELF_SERVICE_ONBOARDING_ENABLED'],
  requiredAnyEnvVars: ['CONSENT_INTEGRITY_SECRET', 'AUTH_SECRET', 'NEXTAUTH_SECRET', 'JWT_SECRET'],
};

type OnboardingRequestRow = {
  id: string;
  status: string;
  tenant_id: string | null;
  organization_id: string | null;
  user_id: string | null;
  marketing_consent: boolean | null;
  completed_at: Date | null;
};

type UserConsentRow = {
  consent_type: string;
  is_granted: boolean;
  source: string | null;
  integrity_hash: string | null;
  granted_at: Date | null;
};

const ONBOARDING_PASSWORD = 'IntegrationPass123!';
const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function replaceVerificationToken(email: string, token: string): Promise<string> {
  return withClient(async (client) => {
    const result = await client.query<{ id: string }>(
      `update onboarding_requests
         set token_hash = $2,
             expires_at = now() + interval '24 hours',
             updated_at = now()
       where email = $1
       returning id`,
      [email, hashToken(token)],
    );
    expect(result.rowCount, 'onboarding request should exist after submitting the form').toBe(1);
    return result.rows[0].id;
  });
}

async function readCompletedRequest(requestId: string): Promise<OnboardingRequestRow> {
  return withClient(async (client) => {
    const result = await client.query<OnboardingRequestRow>(
      `select id, status, tenant_id, organization_id, user_id, marketing_consent, completed_at
         from onboarding_requests
        where id = $1`,
      [requestId],
    );
    expect(result.rowCount, 'completed onboarding request should remain queryable').toBe(1);
    return result.rows[0];
  });
}

async function readMarketingConsent(userId: string): Promise<UserConsentRow> {
  return withClient(async (client) => {
    const result = await client.query<UserConsentRow>(
      `select consent_type, is_granted, source, integrity_hash, granted_at
         from user_consents
        where user_id = $1 and consent_type = 'marketing_email'
        order by created_at desc
        limit 1`,
      [userId],
    );
    expect(result.rowCount, 'marketing consent should be persisted for the onboarded user').toBe(1);
    return result.rows[0];
  });
}

test.describe('TC-ONB-001: self-service onboarding with marketing consent', () => {
  test('shows a retryable error when workspace status polling fails', async ({ page }) => {
    const tenantId = '33333333-3333-4333-8333-333333333333';
    await page.route('**/api/onboarding/onboarding/status?**', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'Invalid request origin' }),
      });
    });

    await page.goto(`/onboarding/preparing?tenant=${tenantId}`);

    await expect(page.getByText('We are preparing your workspace')).toBeVisible();
    const statusAlert = page.getByText('Workspace status check failed').locator('..');
    await expect(statusAlert).toContainText('Invalid request origin');
    await expect(page.getByRole('link', { name: 'Open tenant login' }))
      .toHaveAttribute('href', `/login?tenant=${tenantId}`);
  });

  test('creates the workspace, verifies from the email link, and logs in to the new tenant', async ({ page }) => {
    const unique = randomUUID().slice(0, 8);
    const email = `qa-onboarding-${unique}@example.test`;
    const organizationName = `QA Onboarding ${unique}`;
    const token = `integration-onboarding-${randomUUID().replace(/-/g, '')}`;

    await page.goto('/onboarding');
    await expect(page.getByText('Create your Open Mercato workspace')).toBeVisible();

    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('First name').fill('QA');
    await page.getByLabel('Last name').fill('Onboarding');
    await page.getByLabel('Organization name').fill(organizationName);
    await page.locator('input[name="password"]').fill(ONBOARDING_PASSWORD);
    await page.locator('input[name="confirmPassword"]').fill(ONBOARDING_PASSWORD);
    await page.locator('#terms').click();
    await page.locator('#marketingConsent').click();
    await page.getByRole('button', { name: 'Send verification email' }).click();

    await expect(page.getByRole('status')).toContainText('Check your inbox');
    await expect(page.getByRole('status')).toContainText(email);

    const requestId = await replaceVerificationToken(email, token);
    const verifyUrl = `${BASE_URL}/api/onboarding/onboarding/verify?token=${encodeURIComponent(token)}`;

    await page.setContent(`<a href="${verifyUrl}">Verify workspace</a>`);
    await page.getByRole('link', { name: 'Verify workspace' }).click();
    await expect(page).toHaveURL(/\/onboarding\/preparing\?tenant=[0-9a-f-]+/);
    await expect(page.getByText('We are preparing your workspace')).toBeVisible();

    const completed = await readCompletedRequest(requestId);
    expect(completed.status).toBe('completed');
    expect(completed.marketing_consent).toBe(true);
    expect(completed.completed_at).toBeTruthy();
    expect(completed.tenant_id, 'tenant id should be recorded').toBeTruthy();
    expect(completed.organization_id, 'organization id should be recorded').toBeTruthy();
    expect(completed.user_id, 'user id should be recorded').toBeTruthy();

    const consent = await readMarketingConsent(completed.user_id!);
    expect(consent.consent_type).toBe('marketing_email');
    expect(consent.is_granted).toBe(true);
    expect(consent.source).toBeTruthy();
    expect(consent.granted_at).toBeTruthy();
    expect(consent.integrity_hash, 'consent integrity hash should be computed instead of redirecting to status=error').toBeTruthy();

    await page.goto(`/login?tenant=${encodeURIComponent(completed.tenant_id!)}`);
    await expect(page.locator('form[data-auth-ready="1"]')).toBeVisible();
    await expect(page.getByText(/You're logging in to/i)).toBeVisible();
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(ONBOARDING_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/backend(?:\/.*)?$/);
  });
});
