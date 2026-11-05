import { createHash, randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { withClient, type IntegrationDbClient } from '@open-mercato/core/helpers/integration/dbFixtures';
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

async function purgeOnboardingFixture(email: string, knownTenantId: string | null): Promise<void> {
  await withClient(async (client) => {
    const requests = await client.query<{ tenant_id: string | null }>(
      'select tenant_id from onboarding_requests where email_hash = any($1::text[])',
      [lookupHashCandidates(email)],
    );
    const tenantIds = new Set<string>();
    if (knownTenantId) tenantIds.add(knownTenantId);
    for (const row of requests.rows) if (row.tenant_id) tenantIds.add(row.tenant_id);
    for (const tenantId of tenantIds) await purgeTenantWorkspace(client, tenantId);
    await client.query('delete from onboarding_requests where email_hash = any($1::text[])', [lookupHashCandidates(email)]);
  });
}

async function purgeTenantWorkspace(client: IntegrationDbClient, tenantId: string): Promise<void> {
  const untenantedChildren = await client.query<{ child: string; child_column: string; parent: string; parent_column: string }>(
    `select child.relname as child, child_col.attname as child_column, parent.relname as parent, parent_col.attname as parent_column
       from pg_constraint fk
       join pg_class child on child.oid = fk.conrelid
       join pg_class parent on parent.oid = fk.confrelid
       join pg_attribute child_col on child_col.attrelid = fk.conrelid and child_col.attnum = fk.conkey[1]
       join pg_attribute parent_col on parent_col.attrelid = fk.confrelid and parent_col.attnum = fk.confkey[1]
      where fk.contype = 'f'
        and array_length(fk.conkey, 1) = 1
        and fk.connamespace = current_schema()::regnamespace
        and not exists (select 1 from pg_attribute a where a.attrelid = fk.conrelid and a.attname = 'tenant_id' and not a.attisdropped)
        and exists (select 1 from pg_attribute a where a.attrelid = fk.confrelid and a.attname = 'tenant_id' and not a.attisdropped)`,
  );
  for (const link of untenantedChildren.rows) {
    await client.query(
      `delete from "${link.child}" where "${link.child_column}" in (select "${link.parent_column}" from "${link.parent}" where tenant_id = $1)`,
      [tenantId],
    );
  }
  const tenantTables = await client.query<{ table_name: string }>(
    `select table_name from information_schema.columns
      where table_schema = current_schema() and column_name = 'tenant_id'
        and table_name in (select table_name from information_schema.tables where table_schema = current_schema() and table_type = 'BASE TABLE')`,
  );
  let pending = tenantTables.rows.map((row) => row.table_name);
  for (let pass = 0; pending.length > 0 && pass < 20; pass += 1) {
    const blocked: string[] = [];
    for (const table of pending) {
      try {
        await client.query(`delete from "${table}" where tenant_id = $1`, [tenantId]);
      } catch (error) {
        if ((error as { code?: string }).code !== '23503') throw error;
        blocked.push(table);
      }
    }
    pending = blocked;
  }
  if (pending.length > 0) throw new Error(`[internal] could not purge tenant ${tenantId} from: ${pending.join(', ')}`);
  await client.query('delete from tenants where id = $1', [tenantId]);
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

    let tenantId: string | null = null;
    try {
      await submitOnboarding(request, email, `QA Duplicate Verify ${unique}`);
      const requestId = await replaceVerificationToken(email, token);
      await warmUpRoutes(request);

      const lock = await holdCurrenciesWriteLock();
      let lockReleased = false;
      let originalVerify: ReturnType<APIRequestContext['get']> | null = null;
      try {
        originalVerify = request.get(verifyUrl, { maxRedirects: 0, timeout: 120_000 });
        const blockedTenantId = await waitForSeedDefaultsBlocked(requestId, lock.pid);
        tenantId = blockedTenantId;
        const blockedAt = Date.now();

        const duplicate = await request.get(verifyUrl, { maxRedirects: 0 });
        expect(duplicate.status()).toBe(307);
        expect(duplicate.headers()['location']).toContain(`/onboarding/preparing?tenant=${blockedTenantId}`);

        const statusResponse = await pollOnboardingStatus(request, blockedTenantId);
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
        expect(original.headers()['location']).toContain(`/onboarding/preparing?tenant=${blockedTenantId}`);

        const finalState = await waitForPreparationComplete(request, requestId, blockedTenantId);
        expect(finalState.status).toBe('completed');
        expect(finalState.preparation_completed_at, 'workspace preparation should complete').toBeTruthy();
      } finally {
        if (!lockReleased) await lock.release();
        if (originalVerify) await originalVerify.catch(() => undefined);
      }
    } finally {
      await purgeOnboardingFixture(email, tenantId);
    }
  });
});
