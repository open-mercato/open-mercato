import { test, expect } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { deletePendingActionInDb, resolveIntegrationMcpMutationMode } from './helpers/aiAssistantFixtures';
import {
  ACTIONS_PATH,
  DEAL_INITIAL_STATUS,
  DEAL_MUTATION_TOOL,
  GET_PENDING_ACTION_TOOL,
  createOpenDeal,
  createScopedUser,
  deleteDeal,
  deleteScopedUser,
  executeTool,
  queueDealStageChange,
  readDealStatus,
  readPendingAction,
  type ScopedUserFixture,
} from './helpers/mcpFixtures';

/**
 * TC-AI-MCP-APPROVAL-016 — `/tools/execute` 202 contract in approval mode.
 * Source: spec `.ai/specs/2026-10-21-mcp-tool-exposure-parity-and-audit.md`.
 *
 * Surfaces under test:
 *   - /api/ai_assistant/tools/execute        (POST -> 202)
 *   - /api/ai_assistant/ai/actions/{id}       (GET, owner view)
 *   - `ai_assistant.get_pending_action` tool  (via /tools/execute)
 *
 * With `OM_MCP_MUTATION_MODE=approval` a mutation answers exactly
 * `202 { success: true, status: 'pending_approval', pendingActionId, expiresAt }`,
 * the handler does not run, and the requester can read the queued row
 * (`channel: 'tools-api'`, `requester.userId` = caller) and poll it through
 * `ai_assistant.get_pending_action`.
 *
 * Mode gating: runs only when the app server was started with
 * `OM_MCP_MUTATION_MODE=approval` (the ephemeral runner forwards its process env
 * to the app server: `OM_MCP_MUTATION_MODE=approval yarn test:integration:ephemeral`).
 * Skipped under the default `direct` mode; the 202 envelope is also covered by
 * `api/tools/execute/__tests__/route.test.ts`.
 */

const mutationMode = resolveIntegrationMcpMutationMode();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

test.describe('TC-AI-MCP-APPROVAL-016: /tools/execute 202 shape', () => {
  test.skip(mutationMode !== 'approval', 'requires the app server to run with OM_MCP_MUTATION_MODE=approval');

  test('a queued mutation returns the pending-approval envelope and leaves the record untouched', async ({ request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    let requester: ScopedUserFixture | null = null;
    let dealId: string | null = null;
    let pendingActionId: string | null = null;

    try {
      requester = await createScopedUser(request, adminToken, {
        label: 'requester',
        features: ['ai_assistant.view', 'customers.deals.view', 'customers.deals.manage'],
      });
      dealId = await createOpenDeal(request, adminToken);

      const queued = await queueDealStageChange(request, requester.token, dealId);
      pendingActionId = queued.pendingActionId;
      expect(Object.keys(queued.body).sort()).toEqual(['expiresAt', 'pendingActionId', 'status', 'success']);
      expect(queued.body.success).toBe(true);
      expect(queued.body.status).toBe('pending_approval');
      expect(pendingActionId).toMatch(UUID_PATTERN);
      expect(Date.parse(queued.body.expiresAt ?? '')).toBeGreaterThan(Date.now());

      expect(await readDealStatus(request, adminToken, dealId), 'handler did not run').toBe(DEAL_INITIAL_STATUS);

      const detail = await readPendingAction(request, requester.token, pendingActionId);
      expect(detail.status).toBe(200);
      expect(detail.body?.status).toBe('pending');
      expect(detail.body?.toolName).toBe(DEAL_MUTATION_TOOL);
      expect(detail.body?.channel).toBe('tools-api');
      expect(detail.body?.requester?.userId).toBe(requester.userId);
      expect(detail.body?.requester?.apiKeyId ?? null).toBeNull();

      const poll = await executeTool(request, requester.token, GET_PENDING_ACTION_TOOL, { pendingActionId });
      expect(poll.status()).toBe(200);
      const pollBody = await readJsonSafe<{ success?: boolean; result?: { status?: string } }>(poll);
      expect(pollBody?.success).toBe(true);
      expect(pollBody?.result?.status).toBe('pending');
    } finally {
      if (pendingActionId && requester) {
        await apiRequest(request, 'POST', `${ACTIONS_PATH}/${pendingActionId}/cancel`, {
          token: requester.token,
          data: {},
        }).catch(() => undefined);
      }
      await deletePendingActionInDb(pendingActionId).catch(() => undefined);
      await deleteDeal(request, adminToken, dealId);
      await deleteScopedUser(request, adminToken, requester);
    }
  });
});
