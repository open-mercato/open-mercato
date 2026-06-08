import { test, expect, request as playwrightRequest } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-AI-TOOLS-EXECUTE-007 — Direct tool execution + tool listing.
 * Source: GitHub issue #2495.
 *
 * Surfaces under test:
 *   - /api/ai_assistant/tools          (GET)
 *   - /api/ai_assistant/tools/execute   (POST)
 *
 * Contract notes verified against the route handlers (the issue's guesses were wrong):
 *   - execute body fields are `toolName` + `args` (NOT `name` / `input`);
 *     success is 200 `{ success: true, result }`.
 *   - a missing `toolName` -> 400 `{ error: 'toolName is required' }`.
 *   - an unknown tool -> 400 `{ success: false, error: 'Tool "<n>" not found' }`
 *     (NOT a typed `code`; the errorCode only selects 400 vs 403 internally).
 *   - both routes require `ai_assistant.view`; the per-tool `requiredFeatures` are
 *     enforced separately inside the executor.
 */

const TOOLS = '/api/ai_assistant/tools';
const EXECUTE = '/api/ai_assistant/tools/execute';

interface ToolSummary {
  name: string;
  description: string;
  inputSchema: { required?: unknown } & Record<string, unknown>;
  module: string;
}

test.describe('TC-AI-TOOLS-EXECUTE-007: Direct tool execution', () => {
  test('list tools, validate + reject unknown tools, and exercise a no-arg tool', async ({ request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');

    const listRes = await apiRequest(request, 'GET', TOOLS, { token: adminToken });
    expect(listRes.status()).toBe(200);
    const list = await readJsonSafe<{ tools: ToolSummary[] }>(listRes);
    expect(Array.isArray(list?.tools)).toBe(true);
    expect((list?.tools.length ?? 0) > 0, 'at least one tool is visible to admin').toBe(true);
    const sample = list!.tools[0];
    expect(typeof sample.name).toBe('string');
    expect(typeof sample.inputSchema).toBe('object');

    // Missing toolName -> 400 with the route-level message.
    const missing = await apiRequest(request, 'POST', EXECUTE, { token: adminToken, data: {} });
    expect(missing.status()).toBe(400);
    expect((await readJsonSafe<{ error?: string }>(missing))?.error).toBe('toolName is required');

    // Unknown tool -> 400 { success: false, error: '... not found' }.
    const unknown = await apiRequest(request, 'POST', EXECUTE, {
      token: adminToken,
      data: { toolName: 'does.not_exist_tool', args: {} },
    });
    expect(unknown.status()).toBe(400);
    const unknownBody = await readJsonSafe<{ success?: boolean; error?: string }>(unknown);
    expect(unknownBody?.success).toBe(false);
    expect(unknownBody?.error ?? '').toContain('not found');

    // Best-effort happy path: a tool whose input schema has no required fields can
    // be invoked with empty args. The execute route runs the handler and returns
    // 200 `{ success }`; assert the envelope only when such a tool is available.
    const noArgTool = list!.tools.find((tool) => {
      const required = tool.inputSchema?.required;
      return !Array.isArray(required) || required.length === 0;
    });
    if (noArgTool) {
      const exec = await apiRequest(request, 'POST', EXECUTE, {
        token: adminToken,
        data: { toolName: noArgTool.name, args: {} },
      });
      // A 200 from the execute route always carries `success: true` (only a
      // thrown handler yields 400 `{ success: false }`), so assert the real
      // value rather than mere presence. A no-arg tool that rejects empty input
      // legitimately returns 400, which this guard intentionally tolerates.
      if (exec.status() === 200) {
        expect((await readJsonSafe<{ success?: boolean }>(exec))?.success).toBe(true);
      }
    }
  });

  test('unauthenticated execute is rejected with 401', async ({ baseURL }) => {
    const anon = await playwrightRequest.newContext({ baseURL });
    try {
      const res = await anon.fetch(EXECUTE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ toolName: 'does.not_exist_tool', args: {} }),
      });
      expect(res.status()).toBe(401);
    } finally {
      await anon.dispose();
    }
  });
});
