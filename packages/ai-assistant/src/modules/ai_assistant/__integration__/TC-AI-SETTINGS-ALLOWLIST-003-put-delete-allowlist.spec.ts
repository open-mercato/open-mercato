import { test, expect, request as playwrightRequest } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { deleteTenantAllowlistInDb } from './helpers/aiAssistantFixtures';

/**
 * TC-AI-SETTINGS-ALLOWLIST-003 — Tenant model allowlist (PUT/DELETE) + settings reflection.
 * Source: GitHub issue #2495.
 *
 * Surfaces under test:
 *   - /api/ai_assistant/settings/allowlist   (PUT, DELETE)
 *   - /api/ai_assistant/settings             (GET — reflects the snapshot)
 *
 * Contract notes verified against the route handlers:
 *   - PUT body fields are `allowedProviders` / `allowedModelsByProvider`
 *     (NOT `providers` / `models`); success is 200 returning the saved snapshot.
 *   - DELETE returns 200 `{ cleared: boolean }` and is idempotent
 *     (`cleared: false` when no active row exists).
 *   - GET /settings exposes `tenantAllowlist` (null when unset) + `effectiveAllowlist`.
 *   - PUT/DELETE require `ai_assistant.settings.manage`.
 *
 * Out of scope (documented): the `provider_not_in_env_allowlist` 400 branch only
 * fires when the APP process has `OM_AI_AVAILABLE_PROVIDERS` set to exclude the
 * provider. The deterministic harness does not control the app's env, so that
 * branch is covered by the module's unit tests; here we assert the env-agnostic
 * Zod validation (wrong type -> 400 validation_error) instead.
 */

const ALLOWLIST = '/api/ai_assistant/settings/allowlist';
const SETTINGS = '/api/ai_assistant/settings';

interface TenantAllowlistSnapshot {
  allowedProviders: string[] | null;
  allowedModelsByProvider: Record<string, string[]>;
}

test.describe('TC-AI-SETTINGS-ALLOWLIST-003: Tenant model allowlist', () => {
  test('PUT persists, GET reflects, DELETE clears + is idempotent', async ({ request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    const { tenantId } = getTokenScope(adminToken);
    try {
      // Start from a known-clean state.
      const reset = await apiRequest(request, 'DELETE', ALLOWLIST, { token: adminToken });
      expect(reset.status()).toBe(200);

      const settingsBefore = await apiRequest(request, 'GET', SETTINGS, { token: adminToken });
      expect(settingsBefore.status()).toBe(200);
      const before = await readJsonSafe<{ tenantAllowlist: TenantAllowlistSnapshot | null; effectiveAllowlist: unknown }>(
        settingsBefore,
      );
      expect(before?.tenantAllowlist).toBeNull();
      expect(before?.effectiveAllowlist).toBeTruthy();

      const put = await apiRequest(request, 'PUT', ALLOWLIST, {
        token: adminToken,
        data: { allowedProviders: ['openai'], allowedModelsByProvider: { openai: ['gpt-5-mini'] } },
      });
      expect(put.status(), 'PUT allowlist returns 200').toBe(200);
      const saved = await readJsonSafe<TenantAllowlistSnapshot>(put);
      expect(saved?.allowedProviders).toContain('openai');
      expect(saved?.allowedModelsByProvider?.openai).toContain('gpt-5-mini');

      const settingsAfter = await apiRequest(request, 'GET', SETTINGS, { token: adminToken });
      expect(settingsAfter.status()).toBe(200);
      const after = await readJsonSafe<{ tenantAllowlist: TenantAllowlistSnapshot | null }>(settingsAfter);
      expect(after?.tenantAllowlist?.allowedProviders).toContain('openai');

      const del = await apiRequest(request, 'DELETE', ALLOWLIST, { token: adminToken });
      expect(del.status()).toBe(200);
      expect((await readJsonSafe<{ cleared: boolean }>(del))?.cleared).toBe(true);

      const settingsCleared = await apiRequest(request, 'GET', SETTINGS, { token: adminToken });
      const cleared = await readJsonSafe<{ tenantAllowlist: TenantAllowlistSnapshot | null }>(settingsCleared);
      expect(cleared?.tenantAllowlist).toBeNull();

      const delAgain = await apiRequest(request, 'DELETE', ALLOWLIST, { token: adminToken });
      expect(delAgain.status()).toBe(200);
      expect((await readJsonSafe<{ cleared: boolean }>(delAgain))?.cleared, 'DELETE is idempotent').toBe(false);
    } finally {
      await deleteTenantAllowlistInDb(tenantId).catch(() => undefined);
    }
  });

  test('validation + RBAC gates: bad body 400, employee 403, unauthenticated 401', async ({ request, baseURL }) => {
    const adminToken = await getAuthToken(request, 'admin');

    const badType = await apiRequest(request, 'PUT', ALLOWLIST, {
      token: adminToken,
      data: { allowedProviders: 123 },
    });
    expect(badType.status()).toBe(400);
    expect((await readJsonSafe<{ code?: string }>(badType))?.code).toBe('validation_error');

    // Employee carries ai_assistant.view but NOT ai_assistant.settings.manage.
    const employeeToken = await getAuthToken(request, 'employee');
    const denied = await apiRequest(request, 'PUT', ALLOWLIST, {
      token: employeeToken,
      data: { allowedProviders: ['openai'] },
    });
    expect(denied.status(), 'employee lacks settings.manage -> 403').toBe(403);

    const anon = await playwrightRequest.newContext({ baseURL });
    try {
      const res = await anon.fetch(ALLOWLIST, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ allowedProviders: ['openai'] }),
      });
      expect(res.status(), 'unauthenticated PUT is 401').toBe(401);
    } finally {
      await anon.dispose();
    }
  });
});
