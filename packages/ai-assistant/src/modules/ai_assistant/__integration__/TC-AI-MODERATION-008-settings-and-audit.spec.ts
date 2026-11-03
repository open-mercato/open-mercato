import { test, expect, request as playwrightRequest } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  deleteAgentOverridesInDb,
  deleteModerationFlagsInDb,
  seedModerationFlagInDb,
} from './helpers/aiAssistantFixtures';

/**
 * TC-AI-MODERATION-008 — Input-moderation settings + audit API.
 * Source: spec `.ai/specs/2026-06-04-ai-input-moderation-and-safety-identifiers.md`.
 *
 * Surfaces under test:
 *   - PUT /api/ai_assistant/settings        (persists `inputModeration` per agent)
 *   - GET /api/ai_assistant/settings        (reflects per-agent effective moderation policy)
 *   - GET /api/ai_assistant/moderation-flags (tenant-scoped audit listing)
 *
 * Contract notes verified against the route handlers:
 *   - PUT `{ agentId, inputModeration }` returns 200 echoing `inputModeration`.
 *   - GET /settings exposes `agents[].moderation = { enforced, override, effective }`.
 *   - GET /moderation-flags returns `{ items, total, page, pageSize }`, tenant-scoped,
 *     gated by `ai_assistant.settings.manage`, `pageSize` capped at 100.
 *
 * Flags are seeded directly in the DB: a real flag is only ever born from the gate
 * during a flagged LLM turn (needs a live moderation call), so seeding keeps the
 * audit + isolation coverage deterministic and provider-free. This spec therefore
 * only runs under the coherent app+DB harness (`yarn test:integration` / `:ephemeral`).
 */

const SETTINGS = '/api/ai_assistant/settings';
const FLAGS = '/api/ai_assistant/moderation-flags';

interface FlagsResponse {
  items: Array<{ id: string; tenantId: string; agentId: string; userId: string; categories: Record<string, unknown> }>;
  total: number;
  page: number;
  pageSize: number;
}

test.describe('TC-AI-MODERATION-008: input moderation settings + audit', () => {
  test('PUT inputModeration persists per agent and round-trips on/off/inherit', async ({ request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    const { tenantId } = getTokenScope(adminToken);
    // A synthetic agent id keeps the test independent of the (empty-in-CI) live
    // agent registry; the PUT upserts an override row keyed by this id. The
    // per-agent `moderation` reflection on GET (registered agents only) is
    // covered by the route unit tests + the stubbed UI spec (TC-AI-MODERATION-009).
    const agentId = 'it.moderation_settings';

    try {
      const on = await apiRequest(request, 'PUT', SETTINGS, {
        token: adminToken,
        data: { agentId, inputModeration: true },
      });
      expect(on.status(), 'PUT inputModeration=true returns 200').toBe(200);
      expect((await readJsonSafe<{ inputModeration: boolean | null }>(on))?.inputModeration).toBe(true);

      const off = await apiRequest(request, 'PUT', SETTINGS, {
        token: adminToken,
        data: { agentId, inputModeration: false },
      });
      expect(off.status()).toBe(200);
      expect((await readJsonSafe<{ inputModeration: boolean | null }>(off))?.inputModeration).toBe(false);

      const inherit = await apiRequest(request, 'PUT', SETTINGS, {
        token: adminToken,
        data: { agentId, inputModeration: null },
      });
      expect(inherit.status()).toBe(200);
      expect((await readJsonSafe<{ inputModeration: boolean | null }>(inherit))?.inputModeration).toBeNull();
    } finally {
      await deleteAgentOverridesInDb({ tenantId, agentId }).catch(() => undefined);
    }
  });

  test('GET /moderation-flags is tenant-scoped (cross-tenant rows are never returned)', async ({ request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    const { tenantId } = getTokenScope(adminToken);
    const otherTenantId = '00000000-0000-4000-8000-0000000face7';

    let mineId = '';
    try {
      mineId = await seedModerationFlagInDb({ tenantId, agentId: 'it.moderation_audit', userId: 'it-user-mine' });
      await seedModerationFlagInDb({ tenantId: otherTenantId, agentId: 'it.moderation_audit', userId: 'it-user-other' });

      const res = await apiRequest(request, 'GET', `${FLAGS}?pageSize=100`, { token: adminToken });
      expect(res.status()).toBe(200);
      const body = await readJsonSafe<FlagsResponse>(res);
      expect(body?.items, 'returns an items array').toBeTruthy();
      const ids = (body?.items ?? []).map((row) => row.id);
      expect(ids, 'my tenant flag is visible').toContain(mineId);
      // Every returned row is scoped to the caller's tenant — the other-tenant row never leaks.
      for (const row of body?.items ?? []) {
        expect(row.tenantId).toBe(tenantId);
      }
    } finally {
      await deleteModerationFlagsInDb(tenantId).catch(() => undefined);
      await deleteModerationFlagsInDb(otherTenantId).catch(() => undefined);
    }
  });

  test('GET /moderation-flags RBAC + validation gates', async ({ request, baseURL }) => {
    const adminToken = await getAuthToken(request, 'admin');

    // pageSize above the 100 cap is rejected by the zod query schema.
    const tooLarge = await apiRequest(request, 'GET', `${FLAGS}?pageSize=101`, { token: adminToken });
    expect(tooLarge.status()).toBe(400);
    expect((await readJsonSafe<{ code?: string }>(tooLarge))?.code).toBe('validation_error');

    // Employee carries ai_assistant.view but NOT ai_assistant.settings.manage.
    const employeeToken = await getAuthToken(request, 'employee');
    const denied = await apiRequest(request, 'GET', FLAGS, { token: employeeToken });
    expect(denied.status(), 'employee lacks settings.manage -> 403').toBe(403);

    const anon = await playwrightRequest.newContext({ baseURL });
    try {
      const res = await anon.fetch(FLAGS, { method: 'GET' });
      expect(res.status(), 'unauthenticated GET is 401').toBe(401);
    } finally {
      await anon.dispose();
    }
  });
});
