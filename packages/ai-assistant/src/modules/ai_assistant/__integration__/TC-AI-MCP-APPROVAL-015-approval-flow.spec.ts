import { test, expect } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { deletePendingActionInDb, resolveIntegrationMcpMutationMode } from './helpers/aiAssistantFixtures';
import {
  ACTIONS_PATH,
  APPROVER_FEATURES,
  DEAL_INITIAL_STATUS,
  DEAL_TARGET_STATUS,
  GET_PENDING_ACTION_TOOL,
  PENDING_ACTIONS_PAGE,
  REQUESTER_FEATURES,
  createOpenDeal,
  createScopedUser,
  deleteDeal,
  deleteScopedUser,
  executeTool,
  loginAsScopedUser,
  queueDealStageChange,
  readDealStatus,
  readPendingAction,
  type ScopedUserFixture,
} from './helpers/mcpFixtures';

/**
 * TC-AI-MCP-APPROVAL-015 — Approval mode end to end.
 * Source: spec `.ai/specs/2026-10-21-mcp-tool-exposure-parity-and-audit.md`.
 *
 * Surfaces under test:
 *   - /api/ai_assistant/tools/execute              (POST -> 202 queue)
 *   - /api/ai_assistant/ai/actions/{id}             (GET)
 *   - /api/ai_assistant/ai/actions/{id}/confirm     (POST, approver)
 *   - /api/ai_assistant/ai/actions/{id}/cancel      (POST, approver with reason)
 *   - `ai_assistant.get_pending_action` tool        (via /tools/execute)
 *   - /backend/config/ai-assistant/pending-actions  (list -> detail -> Approve)
 *
 * A requester (no approve feature) queues a deal stage change; the record stays
 * unchanged until a second fixture user holding `ai_assistant.pending_actions.approve`
 * approves it, after which the record changes
 * and the row reads `confirmed`. A user without the approve feature who does not
 * own the row gets 404 on read/confirm/cancel. Rejecting with a reason leaves
 * the row `cancelled` and the record unchanged.
 *
 * Mode gating: runs only when the app server was started with
 * `OM_MCP_MUTATION_MODE=approval` (the ephemeral runner forwards its process env
 * to the app server: `OM_MCP_MUTATION_MODE=approval yarn test:integration:ephemeral`).
 * Skipped under the default `direct` mode.
 */

const mutationMode = resolveIntegrationMcpMutationMode();

test.describe('TC-AI-MCP-APPROVAL-015: approval mode flow', () => {
  test.skip(mutationMode !== 'approval', 'requires the app server to run with OM_MCP_MUTATION_MODE=approval');

  test('approver confirms via API; outsiders get 404; get_pending_action reports confirmed', async ({ request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    let requester: ScopedUserFixture | null = null;
    let approver: ScopedUserFixture | null = null;
    let outsider: ScopedUserFixture | null = null;
    let dealId: string | null = null;
    let pendingActionId: string | null = null;

    try {
      requester = await createScopedUser(request, adminToken, { label: 'requester', features: REQUESTER_FEATURES });
      approver = await createScopedUser(request, adminToken, { label: 'approver', features: APPROVER_FEATURES });
      outsider = await createScopedUser(request, adminToken, { label: 'outsider', features: ['ai_assistant.view'] });
      dealId = await createOpenDeal(request, adminToken);

      pendingActionId = (await queueDealStageChange(request, requester.token, dealId)).pendingActionId;
      expect(await readDealStatus(request, adminToken, dealId)).toBe(DEAL_INITIAL_STATUS);

      const outsiderRead = await readPendingAction(request, outsider.token, pendingActionId);
      expect(outsiderRead.status, 'non-owner without the approve feature cannot read').toBe(404);
      for (const decision of ['confirm', 'cancel'] as const) {
        const outsiderDecision = await apiRequest(request, 'POST', `${ACTIONS_PATH}/${pendingActionId}/${decision}`, {
          token: outsider.token,
          data: {},
        });
        expect(outsiderDecision.status(), `non-owner ${decision} is 404`).toBe(404);
      }

      const approverView = await readPendingAction(request, approver.token, pendingActionId);
      expect(approverView.status).toBe(200);
      expect(approverView.body?.status).toBe('pending');
      expect(approverView.body?.channel).toBe('tools-api');
      expect(approverView.body?.requester?.userId).toBe(requester.userId);

      const confirm = await apiRequest(request, 'POST', `${ACTIONS_PATH}/${pendingActionId}/confirm`, {
        token: approver.token,
        data: {},
      });
      const confirmBody = await readJsonSafe<{ ok?: boolean; pendingAction?: { status?: string } }>(confirm);
      expect(confirm.status(), `confirm body: ${JSON.stringify(confirmBody)}`).toBe(200);
      expect(confirmBody?.ok).toBe(true);
      expect(confirmBody?.pendingAction?.status).toBe('confirmed');

      expect(await readDealStatus(request, adminToken, dealId)).toBe(DEAL_TARGET_STATUS);
      expect((await readPendingAction(request, approver.token, pendingActionId)).body?.status).toBe('confirmed');

      const poll = await executeTool(request, requester.token, GET_PENDING_ACTION_TOOL, { pendingActionId });
      expect(poll.status()).toBe(200);
      const pollBody = await readJsonSafe<{ result?: { status?: string; resolvedAt?: string | null } }>(poll);
      expect(pollBody?.result?.status).toBe('confirmed');
      expect(pollBody?.result?.resolvedAt).toBeTruthy();
    } finally {
      await deletePendingActionInDb(pendingActionId).catch(() => undefined);
      await deleteDeal(request, adminToken, dealId);
      await deleteScopedUser(request, adminToken, outsider);
      await deleteScopedUser(request, adminToken, approver);
      await deleteScopedUser(request, adminToken, requester);
    }
  });

  test('approver rejects with a reason; the row is cancelled and the record unchanged', async ({ request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    let requester: ScopedUserFixture | null = null;
    let approver: ScopedUserFixture | null = null;
    let dealId: string | null = null;
    let pendingActionId: string | null = null;

    try {
      requester = await createScopedUser(request, adminToken, { label: 'requester', features: REQUESTER_FEATURES });
      approver = await createScopedUser(request, adminToken, { label: 'approver', features: APPROVER_FEATURES });
      dealId = await createOpenDeal(request, adminToken);
      pendingActionId = (await queueDealStageChange(request, requester.token, dealId)).pendingActionId;

      const cancel = await apiRequest(request, 'POST', `${ACTIONS_PATH}/${pendingActionId}/cancel`, {
        token: approver.token,
        data: { reason: 'Integration test rejection' },
      });
      expect(cancel.status()).toBe(200);

      expect((await readPendingAction(request, approver.token, pendingActionId)).body?.status).toBe('cancelled');
      expect((await readPendingAction(request, requester.token, pendingActionId)).body?.status).toBe('cancelled');
      expect(await readDealStatus(request, adminToken, dealId)).toBe(DEAL_INITIAL_STATUS);
    } finally {
      await deletePendingActionInDb(pendingActionId).catch(() => undefined);
      await deleteDeal(request, adminToken, dealId);
      await deleteScopedUser(request, adminToken, approver);
      await deleteScopedUser(request, adminToken, requester);
    }
  });

  test('approver approves from the Pending AI actions page', async ({ page, request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    let requester: ScopedUserFixture | null = null;
    let approver: ScopedUserFixture | null = null;
    let dealId: string | null = null;
    let pendingActionId: string | null = null;

    try {
      requester = await createScopedUser(request, adminToken, { label: 'requester', features: REQUESTER_FEATURES });
      approver = await createScopedUser(request, adminToken, { label: 'approver', features: APPROVER_FEATURES });
      dealId = await createOpenDeal(request, adminToken);
      pendingActionId = (await queueDealStageChange(request, requester.token, dealId)).pendingActionId;

      await loginAsScopedUser(page, approver);
      await page.goto(PENDING_ACTIONS_PAGE, { waitUntil: 'domcontentloaded' });
      const rowLink = page.locator(`a[href$="/pending-actions/${pendingActionId}"]`).first();
      await expect(rowLink).toBeVisible();
      await rowLink.click();
      await page.waitForURL(new RegExp(`/pending-actions/${pendingActionId}$`));

      const approve = page.locator('[data-pending-action-approve]');
      await expect(approve).toBeVisible();
      await approve.click();
      await expect(page.getByText('AI action approved.').first()).toBeVisible();
      await expect(approve).toBeHidden();

      await expect.poll(() => readDealStatus(request, adminToken, dealId!)).toBe(DEAL_TARGET_STATUS);
      expect((await readPendingAction(request, approver.token, pendingActionId)).body?.status).toBe('confirmed');
    } finally {
      await deletePendingActionInDb(pendingActionId).catch(() => undefined);
      await deleteDeal(request, adminToken, dealId);
      await deleteScopedUser(request, adminToken, approver);
      await deleteScopedUser(request, adminToken, requester);
    }
  });
});
