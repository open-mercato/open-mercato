import { test, expect, request as playwrightRequest } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createRoleFixture,
  deleteRoleIfExists,
  createUserFixture,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { deleteUserAclInDb } from '@open-mercato/core/helpers/integration/dbFixtures';
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-AI-SESSION-KEY-006 — Session key generation.
 * Source: GitHub issue #2495.
 *
 * Surface under test:
 *   - /api/ai_assistant/session-key   (POST)
 *
 * Contract notes verified against the route handler (the issue's guesses were wrong):
 *   - the response body is EXACTLY `{ sessionToken, expiresAt }` — it does NOT
 *     include userId / tenantId / organizationId.
 *   - token format is `sess_` + 32 lowercase hex chars; TTL is 120 minutes.
 *   - requires `ai_assistant.view`; unauthenticated -> 401; missing feature -> 403.
 *
 * NOTE: the returned `sess_...` token is consumed only as the MCP `_sessionToken`
 * tool-call argument — it is NOT accepted by the Next.js HTTP auth resolver as a
 * Bearer/header, so the issue's "use the token to call /tools" step is invalid
 * and intentionally omitted here.
 */

const SESSION_KEY = '/api/ai_assistant/session-key';
const SESSION_TOKEN_RE = /^sess_[0-9a-f]{32}$/;
const TTL_MINUTES = 120;

test.describe('TC-AI-SESSION-KEY-006: Session key generation', () => {
  test('POST mints a unique sess_ token with a ~120 minute TTL', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin');

    const first = await apiRequest(request, 'POST', SESSION_KEY, { token: adminToken, data: {} });
    expect(first.status(), 'session-key POST returns 200').toBe(200);
    const body = await readJsonSafe<{ sessionToken: string; expiresAt: string }>(first);
    expect(body?.sessionToken).toMatch(SESSION_TOKEN_RE);

    const now = Date.now();
    const expiresAt = Date.parse(body!.expiresAt);
    expect(Number.isNaN(expiresAt)).toBe(false);
    // Allow generous slop for clock + request latency around the 120-minute TTL.
    expect(expiresAt).toBeGreaterThan(now + (TTL_MINUTES - 5) * 60 * 1000);
    expect(expiresAt).toBeLessThan(now + (TTL_MINUTES + 5) * 60 * 1000);

    const second = await apiRequest(request, 'POST', SESSION_KEY, { token: adminToken, data: {} });
    expect(second.status()).toBe(200);
    const secondBody = await readJsonSafe<{ sessionToken: string }>(second);
    expect(secondBody?.sessionToken).toMatch(SESSION_TOKEN_RE);
    expect(secondBody?.sessionToken, 'each call mints a distinct token').not.toBe(body?.sessionToken);
  });

  test('auth gates: unauthenticated 401 and missing ai_assistant.view 403', async ({ request, baseURL }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    const { organizationId } = getTokenScope(adminToken);
    const stamp = randomUUID().slice(0, 8);
    const password = 'Secret123!';

    const anon = await playwrightRequest.newContext({ baseURL });
    try {
      const res = await anon.fetch(SESSION_KEY, { method: 'POST', data: '{}' });
      expect(res.status(), 'unauthenticated POST is 401').toBe(401);
    } finally {
      await anon.dispose();
    }

    let roleId: string | null = null;
    let userId: string | null = null;
    try {
      roleId = await createRoleFixture(request, adminToken, { name: `IT Session Role ${stamp}` });
      userId = await createUserFixture(request, adminToken, {
        email: `it-session-${stamp}@example.com`,
        password,
        organizationId,
        roles: [roleId],
      });
      await setUserAclVisibility(request, adminToken, { userId, features: [], organizations: null });
      const viewlessToken = await getAuthToken(request, `it-session-${stamp}@example.com`, password);
      const denied = await apiRequest(request, 'POST', SESSION_KEY, { token: viewlessToken, data: {} });
      expect(denied.status(), 'caller without ai_assistant.view is 403').toBe(403);
    } finally {
      await deleteUserAclInDb(userId ?? '').catch(() => undefined);
      await deleteUserIfExists(request, adminToken, userId);
      await deleteRoleIfExists(request, adminToken, roleId);
    }
  });
});
