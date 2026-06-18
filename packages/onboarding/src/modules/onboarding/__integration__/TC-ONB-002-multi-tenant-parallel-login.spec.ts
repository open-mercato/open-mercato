// Adapted from PR #3007 (pkarw) — multi-tenant parallel onboarding repro for the
// 2026-06-11 demo pool-exhaustion outage, ported to the preparation_started_at
// lease column introduced by the single-flight deferred-provisioning fix.
import { createHash, randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures';

export const integrationMeta = {
  dependsOnModules: ['onboarding'],
  requiredEnvVars: ['SELF_SERVICE_ONBOARDING_ENABLED'],
  requiredAnyEnvVars: ['CONSENT_INTEGRITY_SECRET', 'AUTH_SECRET', 'NEXTAUTH_SECRET', 'JWT_SECRET'],
};

type OnboardingTenant = {
  email: string;
  organizationName: string;
  token: string;
  requestId?: string;
  tenantId?: string;
};

type BrowserTenantSession = {
  context: BrowserContext;
  page: Page;
  refreshRequests: string[];
};

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000';
const ONBOARDING_PASSWORD = 'ParallelPass123!';

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
    expect(result.rowCount, `onboarding request should exist for ${email}`).toBe(1);
    return result.rows[0].id;
  });
}

async function readPreparationState(requestId: string): Promise<{
  preparation_completed_at: Date | null;
  preparation_started_at: Date | null;
}> {
  return withClient(async (client) => {
    const result = await client.query<{
      preparation_completed_at: Date | null;
      preparation_started_at: Date | null;
    }>(
      `select preparation_completed_at, preparation_started_at
         from onboarding_requests
        where id = $1`,
      [requestId],
    );
    expect(result.rowCount, `onboarding request ${requestId} should remain queryable`).toBe(1);
    return result.rows[0];
  });
}

async function waitForPreparationComplete(
  request: APIRequestContext,
  tenant: OnboardingTenant,
): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastState: Awaited<ReturnType<typeof readPreparationState>> | null = null;
  while (Date.now() < deadline) {
    // Drive the same recovery the real preparing page provides: it polls the
    // status endpoint every ~1s, and each poll re-schedules deferred
    // provisioning when no fresh claim is held. Watching only the DB would never
    // recover a deferred runner that crashed after claiming its lease.
    await pollOnboardingStatus(request, tenant.tenantId!).catch(() => undefined);
    lastState = await readPreparationState(tenant.requestId!);
    if (lastState.preparation_completed_at && !lastState.preparation_started_at) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  expect(lastState?.preparation_started_at, 'deferred preparation lease should be cleared after completion').toBeNull();
  expect(lastState?.preparation_completed_at, 'workspace preparation should complete').toBeTruthy();
}

async function submitOnboarding(request: APIRequestContext, tenant: OnboardingTenant): Promise<void> {
  const response = await request.post(`${BASE_URL}/api/onboarding/onboarding`, {
    data: {
      email: tenant.email,
      firstName: 'Parallel',
      lastName: 'Login',
      organizationName: tenant.organizationName,
      password: ONBOARDING_PASSWORD,
      confirmPassword: ONBOARDING_PASSWORD,
      termsAccepted: true,
      marketingConsent: true,
      locale: 'en',
    },
  });
  expect(response.status(), `onboarding start should succeed for ${tenant.email}`).toBe(200);
}

async function verifyTenantInBrowser(browser: Browser, token: string): Promise<BrowserTenantSession & { tenantId: string }> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();
  const refreshRequests: string[] = [];
  page.on('request', (browserRequest) => {
    const url = browserRequest.url();
    if (url.includes('/api/auth/session/refresh')) refreshRequests.push(url);
  });

  await page.goto(`/api/onboarding/onboarding/verify?token=${encodeURIComponent(token)}`);
  await expect(page).toHaveURL(/\/onboarding\/preparing\?tenant=[0-9a-f-]+/);
  await expect(page.getByText('We are preparing your workspace')).toBeVisible();
  const tenantId = new URL(page.url()).searchParams.get('tenant');
  expect(tenantId, 'verify redirect should include tenant id').toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  return { context, page, refreshRequests, tenantId: tenantId! };
}

async function pollOnboardingStatus(request: APIRequestContext, tenantId: string) {
  return request.get(`${BASE_URL}/api/onboarding/onboarding/status?tenantId=${encodeURIComponent(tenantId)}`, {
    headers: {
      Cookie: `om_login_tenant=${encodeURIComponent(tenantId)}`,
    },
  });
}

async function loginAndAssertBackend(session: BrowserTenantSession, tenant: OnboardingTenant): Promise<void> {
  expect(tenant.tenantId, `tenant id should exist for ${tenant.email}`).toBeTruthy();
  await expect(session.page).toHaveURL(new RegExp(`/login\\?tenant=${tenant.tenantId}`));
  await expect(session.page.locator('form[data-auth-ready="1"]')).toBeVisible();
  await session.page.getByLabel('Email').fill(tenant.email);
  await session.page.getByLabel('Password', { exact: true }).fill(ONBOARDING_PASSWORD);
  await session.page.getByRole('button', { name: 'Sign in' }).click();
  await expect(session.page, `browser login should land ${tenant.email} in the backend`).toHaveURL(/\/backend(?:\/.*)?$/);
  await expect(session.page.getByText(/Session expired/i)).toHaveCount(0);

  const profileResult = await session.page.evaluate(async () => {
    const response = await fetch('/api/auth/profile', { credentials: 'include' });
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  });
  expect(profileResult.status, `browser page should keep ${tenant.email} authenticated`).toBe(200);
  const profile = profileResult.body;
  expect(profile.email).toBe(tenant.email);
  expect(profile.roles).toContain('admin');

  await session.page.goto('/backend');
  await expect(session.page).toHaveURL(/\/backend(?:\/.*)?$/);
  expect(session.refreshRequests, `backend should not bounce ${tenant.email} through session refresh`).toHaveLength(0);
}

test.describe('TC-ONB-002: multi-tenant onboarding parallel login', () => {
  test('creates two self-service tenants, handles repeated status polling, and keeps both logins authenticated', async ({
    browser,
    request,
  }) => {
    // Two full onboardings + parallel browser logins + DB-polled preparation
    // far exceed the 20s suite default (house pattern: TC-AI-AGENT-SETTINGS-005).
    test.setTimeout(120_000);
    const unique = randomUUID().slice(0, 8);
    const tenants: OnboardingTenant[] = [1, 2].map((index) => ({
      email: `qa-onboarding-parallel-${unique}-${index}@example.test`,
      organizationName: `QA Onboarding Parallel ${unique} ${index}`,
      token: `integration-parallel-${index}-${randomUUID().replace(/-/g, '')}`,
    }));

    await Promise.all(tenants.map((tenant) => submitOnboarding(request, tenant)));

    for (const tenant of tenants) {
      tenant.requestId = await replaceVerificationToken(tenant.email, tenant.token);
    }

    const browserSessions = await Promise.all(
      tenants.map(async (tenant) => {
        const session = await verifyTenantInBrowser(browser, tenant.token);
        tenant.tenantId = session.tenantId;
        return session;
      }),
    );

    try {
      const statusResponses = await Promise.all(
        tenants.flatMap((tenant) =>
          Array.from({ length: 6 }, () => pollOnboardingStatus(request, tenant.tenantId!)),
        ),
      );
      for (const response of statusResponses) {
        expect(response.status(), 'status polling should not exhaust the app DB pool').toBe(200);
      }

      await Promise.all(tenants.map((tenant) => waitForPreparationComplete(request, tenant)));
      await Promise.all(
        tenants.map((tenant, index) => loginAndAssertBackend(browserSessions[index], tenant)),
      );
    } finally {
      await Promise.all(browserSessions.map((session) => session.context.close()));
    }
  });
});
