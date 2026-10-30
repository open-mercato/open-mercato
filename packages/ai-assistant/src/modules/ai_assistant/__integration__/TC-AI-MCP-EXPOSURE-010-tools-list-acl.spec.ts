import { test, expect, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createRoleFixture,
  deleteRoleIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  DEAL_MUTATION_TOOL,
  DEAL_READ_TOOL,
  EXECUTE_PATH,
  TOOLS_PATH,
  uniqueStamp,
} from './helpers/mcpFixtures';

/**
 * TC-AI-MCP-EXPOSURE-010 — Tool listing is filtered per caller.
 * Source: spec `.ai/specs/2026-10-21-mcp-tool-exposure-parity-and-audit.md`.
 *
 * Surfaces under test:
 *   - /api/ai_assistant/tools          (GET, x-api-key principal)
 *   - /api/ai_assistant/tools/execute   (POST, x-api-key principal)
 *
 * An API key bound to a role that grants only `ai_assistant.view` +
 * `customers.deals.view` must see the deal read tools, must NOT see the deal
 * mutation tool, and must be refused (403) when it calls it directly.
 *
 * Harness limitation: the MCP HTTP server (`mcp:serve-http`, which owns the
 * filtered `tools/list` and the `OM_MCP_TOOL_ALLOWLIST` / `OM_MCP_TOOL_DENYLIST`
 * exposure filter) is a separate process that the integration harness does not
 * start, and the exposure env is fixed for the whole app process, so it cannot
 * be varied per test. The allowlist/denylist precedence and the MCP
 * `tools/list` filtering are covered by the unit suites
 * `lib/__tests__/mcp-exposure.test.ts`, `lib/__tests__/http-server.list-filter.test.ts`
 * and `lib/__tests__/mcp-servers.exposure-filter.test.ts`; this spec covers the
 * per-caller ACL filter the app routes share with it.
 */

type ToolSummary = { name: string };

async function listToolNames(request: APIRequestContext, headers: Record<string, string>): Promise<string[]> {
  const response = await request.fetch(TOOLS_PATH, { method: 'GET', headers });
  expect(response.status(), 'GET /api/ai_assistant/tools should return 200').toBe(200);
  const body = await readJsonSafe<{ tools?: ToolSummary[] }>(response);
  expect(Array.isArray(body?.tools)).toBe(true);
  return (body?.tools ?? []).map((tool) => tool.name);
}

test.describe('TC-AI-MCP-EXPOSURE-010: per-caller tool listing', () => {
  test('API key with a limited role lists only permitted tools and cannot call others', async ({ request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    const { organizationId } = getTokenScope(adminToken);
    let roleId: string | null = null;
    let apiKeyId: string | null = null;

    try {
      roleId = await createRoleFixture(request, adminToken, { name: `IT MCP exposure ${uniqueStamp()}` });
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: ['ai_assistant.view', 'customers.deals.view'],
        organizations: null,
      });

      const keyResponse = await apiRequest(request, 'POST', '/api/api_keys/keys', {
        token: adminToken,
        data: { name: `it-mcp-exposure-${uniqueStamp()}`, roles: [roleId], organizationId },
      });
      expect(keyResponse.ok(), `API key fixture creation failed: ${keyResponse.status()}`).toBeTruthy();
      const key = await readJsonSafe<{ id?: string; secret?: string }>(keyResponse);
      apiKeyId = key?.id ?? null;
      expect(typeof key?.secret === 'string' && key.secret.length > 0).toBe(true);
      const keyHeaders = { 'x-api-key': key!.secret!, 'Content-Type': 'application/json' };

      const adminNames = await listToolNames(request, { Authorization: `Bearer ${adminToken}` });
      const keyNames = await listToolNames(request, keyHeaders);

      expect(adminNames).toContain(DEAL_MUTATION_TOOL);
      expect(keyNames).toContain(DEAL_READ_TOOL);
      expect(keyNames, 'mutation tool requiring customers.deals.manage is hidden').not.toContain(DEAL_MUTATION_TOOL);
      expect(keyNames.every((name) => adminNames.includes(name)), 'key listing is a subset of the admin listing').toBe(true);
      expect(keyNames.length).toBeLessThan(adminNames.length);

      const denied = await request.fetch(EXECUTE_PATH, {
        method: 'POST',
        headers: keyHeaders,
        data: JSON.stringify({
          toolName: DEAL_MUTATION_TOOL,
          args: { dealId: '00000000-0000-4000-8000-000000000000', toStage: 'won' },
        }),
      });
      expect(denied.status(), 'calling a tool outside the key role is forbidden').toBe(403);
      const deniedBody = await readJsonSafe<{ success?: boolean; error?: string }>(denied);
      expect(deniedBody?.success).toBe(false);
      expect(deniedBody?.error ?? '').toContain('Insufficient permissions');
    } finally {
      if (apiKeyId) {
        await apiRequest(request, 'DELETE', `/api/api_keys/keys?id=${encodeURIComponent(apiKeyId)}`, {
          token: adminToken,
        }).catch(() => undefined);
      }
      await deleteRoleIfExists(request, adminToken, roleId);
    }
  });
});
