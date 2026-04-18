import { test, expect } from '@playwright/test';
import { getAuthToken } from '../helpers/api';

/**
 * TC-AI-002: AI agent dispatcher policy gate (Step 3.13 / Phase 3 WS-C).
 *
 * Exercises the HTTP surface of the Step 3.2 / 3.3 runtime policy gate end-to-end
 * against the authenticated superadmin session. The dispatcher is
 * `POST /api/ai_assistant/ai/chat?agent=<module>.<agent>` (see
 * `packages/ai-assistant/src/modules/ai_assistant/lib/agent-transport.ts`).
 *
 * Asserted:
 *   - Unknown agent id -> 404 + `{ code: 'agent_unknown' }` — verified against
 *     `packages/ai-assistant/src/modules/ai_assistant/lib/agent-policy.ts`.
 *   - Malformed agent query param -> 400 + `{ code: 'validation_error' }`.
 *   - Missing agent query param -> 400 + `{ code: 'validation_error' }`.
 *   - Unauthenticated caller -> 401 + `{ code: 'unauthenticated' }`.
 *
 * The chat dispatcher requires `ai_assistant.view` — superadmin always carries it.
 * The "forbidden agent" branch (`agent_features_denied`) is exercised at the
 * runtime-helper layer by the Jest integration suite at
 * `packages/ai-assistant/src/modules/ai_assistant/__tests__/integration/
 * ws-c-policy-and-tools.test.ts` because no seeded non-superadmin role has the
 * shape required to create a deterministic forbidden-agent fixture without
 * touching ACL tables.
 */
test.describe('TC-AI-002: AI agent dispatcher policy gate', () => {
  const chatPath = '/api/ai_assistant/ai/chat';

  test('unknown agent returns 404 agent_unknown', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin');

    const response = await request.fetch(`${chatPath}?agent=does.not_exist`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: JSON.stringify({
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    expect(response.status()).toBe(404);
    const body = (await response.json()) as { code?: unknown; error?: unknown };
    expect(body.code).toBe('agent_unknown');
  });

  test('malformed agent query param returns 400 validation_error', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin');

    const response = await request.fetch(`${chatPath}?agent=BadAgent`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: JSON.stringify({
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    expect(response.status()).toBe(400);
    const body = (await response.json()) as { code?: unknown };
    expect(body.code).toBe('validation_error');
  });

  test('missing agent query param returns 400 validation_error', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin');

    const response = await request.fetch(chatPath, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: JSON.stringify({
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    expect(response.status()).toBe(400);
    const body = (await response.json()) as { code?: unknown };
    expect(body.code).toBe('validation_error');
  });

  test('unauthenticated caller returns 401', async ({ request }) => {
    const response = await request.fetch(`${chatPath}?agent=does.not_exist`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      data: JSON.stringify({
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    expect(response.status()).toBe(401);
    const body = (await response.json()) as { code?: unknown };
    expect(body.code).toBe('unauthenticated');
  });
});
