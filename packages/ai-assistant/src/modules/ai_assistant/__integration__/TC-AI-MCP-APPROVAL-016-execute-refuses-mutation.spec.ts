import { test, expect } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  ACTIONS_PATH,
  DEAL_INITIAL_STATUS,
  DEAL_MUTATION_TOOL,
  DEAL_TARGET_STATUS,
  createOpenDeal,
  createScopedUser,
  deleteDeal,
  deleteScopedUser,
  executeTool,
  readDealStatus,
  type ScopedUserFixture,
} from './helpers/mcpFixtures';

/**
 * TC-AI-MCP-APPROVAL-016 — `/tools/execute` refuses mutation tools in every mutation mode.
 * Sources: `.ai/specs/2026-10-31-issue-3805-direct-tool-mutation-approval.md` and
 * `.ai/specs/2026-10-21-mcp-tool-exposure-parity-and-audit.md`.
 *
 * Surfaces under test:
 *   - /api/ai_assistant/tools/execute   (POST -> 403)
 *   - /api/ai_assistant/ai/actions      (GET, nothing queued)
 *
 * `OM_MCP_MUTATION_MODE` governs the MCP servers only. The direct HTTP endpoint has no
 * trusted agent or approval context, so a mutation tool answers
 * `403 { success: false, error }` whatever the mode, the handler never runs and no
 * pending action is created. Runs under every mode.
 */

type ActionsListResponse = { items?: Array<{ id: string; toolName?: string }> };

test.describe('TC-AI-MCP-APPROVAL-016: /tools/execute refuses mutation tools', () => {
  test('a mutation is refused with 403, queues nothing, and leaves the record untouched', async ({ request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    let requester: ScopedUserFixture | null = null;
    let dealId: string | null = null;

    try {
      requester = await createScopedUser(request, adminToken, {
        label: 'requester',
        features: ['ai_assistant.view', 'customers.deals.view', 'customers.deals.manage'],
      });
      dealId = await createOpenDeal(request, adminToken);

      const response = await executeTool(request, requester.token, DEAL_MUTATION_TOOL, {
        dealId,
        toStage: DEAL_TARGET_STATUS,
      });
      const body = await readJsonSafe<{ success?: boolean; error?: string; status?: string }>(response);
      expect(response.status(), `body: ${JSON.stringify(body)}`).toBe(403);
      expect(body?.success).toBe(false);
      expect(typeof body?.error).toBe('string');
      expect(body?.status).toBeUndefined();

      expect(await readDealStatus(request, adminToken, dealId), 'handler did not run').toBe(DEAL_INITIAL_STATUS);

      const query = new URLSearchParams({ toolName: DEAL_MUTATION_TOOL, status: 'pending', pageSize: '100' });
      const list = await apiRequest(request, 'GET', `${ACTIONS_PATH}?${query.toString()}`, { token: requester.token });
      expect(list.status()).toBe(200);
      const listBody = await readJsonSafe<ActionsListResponse>(list);
      expect(listBody?.items ?? []).toHaveLength(0);
    } finally {
      await deleteDeal(request, adminToken, dealId);
      await deleteScopedUser(request, adminToken, requester);
    }
  });
});
