import { test, expect } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { resolveIntegrationMcpMutationMode } from './helpers/aiAssistantFixtures';
import {
  DEAL_INITIAL_STATUS,
  DEAL_MUTATION_TOOL,
  DEAL_TARGET_STATUS,
  createOpenDeal,
  deleteDeal,
  executeTool,
  readDealStatus,
} from './helpers/mcpFixtures';

/**
 * TC-AI-MCP-MUTATION-013 — `OM_MCP_MUTATION_MODE=deny` refuses direct writes.
 * Source: spec `.ai/specs/2026-10-21-mcp-tool-exposure-parity-and-audit.md`.
 *
 * Surface under test: /api/ai_assistant/tools/execute (POST).
 *
 * In deny mode a mutation tool called through `/tools/execute` answers
 * 403 `{ success: false, code: 'MUTATION_REQUIRES_APPROVAL' }` and the handler
 * never runs, so the target record stays unchanged.
 *
 * Mode gating: the mutation mode is read from the app server's environment and
 * is fixed for the whole run, so this spec only runs when the app was started
 * with `OM_MCP_MUTATION_MODE=deny`. The ephemeral runner forwards its own
 * process env to the app server it spawns, so CI enables it with
 * `OM_MCP_MUTATION_MODE=deny yarn test:integration:ephemeral`. Under the default
 * (`direct`) the spec is skipped; the deny gate is also covered by the unit
 * suites `api/tools/execute/__tests__/route.test.ts` and
 * `lib/__tests__/tool-executor.approval.test.ts`.
 */

const mutationMode = resolveIntegrationMcpMutationMode();

test.describe('TC-AI-MCP-MUTATION-013: deny mutation mode', () => {
  test.skip(mutationMode !== 'deny', 'requires the app server to run with OM_MCP_MUTATION_MODE=deny');

  test('a mutation via /tools/execute is refused and the record is unchanged', async ({ request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    let dealId: string | null = null;

    try {
      dealId = await createOpenDeal(request, adminToken);

      const response = await executeTool(request, adminToken, DEAL_MUTATION_TOOL, {
        dealId,
        toStage: DEAL_TARGET_STATUS,
      });
      expect(response.status()).toBe(403);
      const body = await readJsonSafe<{ success?: boolean; code?: string; error?: string }>(response);
      expect(body?.success).toBe(false);
      expect(body?.code).toBe('MUTATION_REQUIRES_APPROVAL');
      expect(typeof body?.error).toBe('string');

      expect(await readDealStatus(request, adminToken, dealId)).toBe(DEAL_INITIAL_STATUS);
    } finally {
      await deleteDeal(request, adminToken, dealId);
    }
  });
});
