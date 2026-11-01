import { createHash, randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures';
import { lookupHashCandidates } from '@open-mercato/shared/lib/encryption/aes';

export const integrationMeta = {
  dependsOnModules: ['onboarding', 'currencies'],
  requiredEnvVars: ['SELF_SERVICE_ONBOARDING_ENABLED'],
  requiredAnyEnvVars: ['CONSENT_INTEGRITY_SECRET', 'AUTH_SECRET', 'NEXTAUTH_SECRET', 'JWT_SECRET'],
};

type RequestState = {
  status: string;
  tenant_id: string | null;
  completed_at: Date | null;
  preparation_started_at: Date | null;
  preparation_completed_at: Date | null;
};

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000';
const ONBOARDING_PASSWORD = 'DuplicateVerify123!';
const PREPARATION_DEADLINE_MS = 180_000;
const SEED_DEFAULTS_HOOK_TIMEOUT_MS = 15_000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function submitOnboarding(request: APIRequestContext, email: string, organizationName: string): Promise<void> {
  const response = await request.post(`${BASE_URL}/api/onboarding/onboarding`, {
    data: {
      email,
      firstName: 'Duplicate',
      lastName: 'Verify',
      organizationName,
      password: ONBOARDING_PASSWORD,
      confirmPassword: ONBOARDING_PASSWORD,
      termsAccepted: true,
      marketingConsent: false,
      locale: 'en',
    },
  });
  expect(response.status(), 'onboarding start should succeed').toBe(200);
}

async function replaceVerificationToken(email: string, token: string): Promise<string> {
  return withClient(async (client) => {
    const result = await client.query<{ id: string }>(
      `update onboarding_requests
         set token_hash = $2,
             expires_at = now() + interval '24 hours',
             updated_at = now()
       where email_hash = any($1::text[])
       returning id`,
      [lookupHashCandidates(email), hashToken(token)],
    );
    expect(result.rowCount, 'onboarding request should exist').toBe(1);
    return result.rows[0].id;
  });
}

async function readRequestState(requestId: string): Promise<RequestState> {
  return withClient(async (client) => {
    const result = await client.query<RequestState>(
      `select status, tenant_id, completed_at, preparation_started_at, preparation_completed_at
         from onboarding_requests
        where id = $1`,
      [requestId],
    );
    expect(result.rowCount, 'onboarding request should remain queryable').toBe(1);
    return result.rows[0];
  });
}

async function holdCurrenciesWriteLock(): Promise<{ pid: number; release: () => Promise<void> }> {
  let releaseLock: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  let announcePid: (pid: number) => void = () => {};
  const pidReady = new Promise<number>((resolve) => {
    announcePid = resolve;
  });
  const holder = withClient(async (client) => {
    await client.query('begin');
    await client.query('lock table currencies in exclusive mode');
    const result = await client.query<{ pid: number }>('select pg_backend_pid() as pid');
    announcePid(result.rows[0].pid);
    await released;
    await client.query('commit');
  });
  const pid = await Promise.race([
    pidReady,
    holder.then(() => {
      throw new Error('[internal] currencies lock holder exited before acquiring the lock');
    }),
  ]);
  return {
    pid,
    release: async () => {
      releaseLock();
      await holder;
    },
  };
}

async function waitForSeedDefaultsBlocked(requestId: string, lockPid: number): Promise<string> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const blocked = await withClient(async (client) => {
      const result = await client.query<{ blocked: number }>(
        `select count(*)::int as blocked from pg_stat_activity where $1 = any(pg_blocking_pids(pid))`,
        [lockPid],
      );
      return result.rows[0].blocked;
    });
    const state = await readRequestState(requestId);
    expect(state.status, 'the original verify should still be provisioning').not.toBe('completed');
    if (blocked > 0 && state.tenant_id) return state.tenant_id;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('[internal] seedDefaults never blocked on the currencies lock');
}

async function waitForPreparationComplete(request: APIRequestContext, requestId: string, tenantId: string): Promise<RequestState> {
  const deadline = Date.now() + PREPARATION_DEADLINE_MS;
  let state = await readRequestState(requestId);
  while (Date.now() < deadline) {
    await pollOnboardingStatus(request, tenantId).catch(() => undefined);
    state = await readRequestState(requestId);
    if (state.preparation_completed_at && !state.preparation_started_at) return state;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return state;
}

async function warmUpRoutes(request: APIRequestContext): Promise<void> {
  await request.get(`${BASE_URL}/api/onboarding/onboarding/verify?token=${'0'.repeat(64)}`, { maxRedirects: 0 });
  await pollOnboardingStatus(request, randomUUID());
}

async function deleteOnboardingRequest(requestId: string): Promise<void> {
  await withClient(async (client) => {
    await client.query('delete from onboarding_requests where id = $1', [requestId]);
  });
}

function pollOnboardingStatus(request: APIRequestContext, tenantId: string) {
  return request.get(`${BASE_URL}/api/onboarding/onboarding/status?tenantId=${encodeURIComponent(tenantId)}`, {
    headers: { Cookie: `om_login_tenant=${encodeURIComponent(tenantId)}` },
  });
}

test.describe('TC-ONB-004: duplicate verify while seedDefaults is still running', () => {
  test('neither a duplicate verify nor a status poll completes the request before seedDefaults finish', async ({ request }) => {
    test.setTimeout(PREPARATION_DEADLINE_MS + 120_000);
    const unique = randomUUID().slice(0, 8);
    const email = `qa-onboarding-duplicate-verify-${unique}@example.test`;
    const token = `integration-duplicate-verify-${randomUUID().replace(/-/g, '')}`;
    const verifyUrl = `${BASE_URL}/api/onboarding/onboarding/verify?token=${encodeURIComponent(token)}`;

    await submitOnboarding(request, email, `QA Duplicate Verify ${unique}`);
    const requestId = await replaceVerificationToken(email, token);
    await warmUpRoutes(request);

    const lock = await holdCurrenciesWriteLock();
    let lockReleased = false;
    let originalVerify: ReturnType<APIRequestContext['get']> | null = null;
    try {
      originalVerify = request.get(verifyUrl, { maxRedirects: 0, timeout: 120_000 });
      const tenantId = await waitForSeedDefaultsBlocked(requestId, lock.pid);
      const blockedAt = Date.now();

      const duplicate = await request.get(verifyUrl, { maxRedirects: 0 });
      expect(duplicate.status()).toBe(307);
      expect(duplicate.headers()['location']).toContain(`/onboarding/preparing?tenant=${tenantId}`);

      const statusResponse = await pollOnboardingStatus(request, tenantId);
      expect(statusResponse.status()).toBe(200);
      const statusBody = await statusResponse.json();
      expect(statusBody.status, 'status poll must not complete a live request').toBe('processing');
      expect(statusBody.ready).toBe(false);

      const midFlight = await readRequestState(requestId);
      expect(midFlight.status, 'duplicate verify must not complete a live request').toBe('processing');
      expect(midFlight.completed_at).toBeNull();
      expect(midFlight.preparation_started_at, 'seedExamples must not start before seedDefaults finish').toBeNull();
      expect(
        Date.now() - blockedAt,
        'mid-flight checks must finish before the stalled seedDefaults hook times out',
      ).toBeLessThan(SEED_DEFAULTS_HOOK_TIMEOUT_MS);

      await lock.release();
      lockReleased = true;

      const original = await originalVerify;
      expect(original.status()).toBe(307);
      expect(original.headers()['location']).toContain(`/onboarding/preparing?tenant=${tenantId}`);

      const finalState = await waitForPreparationComplete(request, requestId, tenantId);
      expect(finalState.status).toBe('completed');
      expect(finalState.preparation_completed_at, 'workspace preparation should complete').toBeTruthy();
    } finally {
      if (!lockReleased) await lock.release();
      if (originalVerify) await originalVerify.catch(() => undefined);
      await deleteOnboardingRequest(requestId);
    }
  });
});
