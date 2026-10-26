import { test, expect, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  deletePendingActionInDb,
  resolveIntegrationMcpMutationMode,
  seedPendingActionInDb,
} from './helpers/aiAssistantFixtures';
import {
  ACTIONS_PATH,
  APPROVER_FEATURES,
  DEAL_INITIAL_STATUS,
  DEAL_MUTATION_TOOL,
  DEAL_TARGET_STATUS,
  EXECUTE_PATH,
  FIXTURE_PASSWORD,
  REQUESTER_FEATURES,
  createOpenDeal,
  createScopedUser,
  deleteDeal,
  deleteScopedUser,
  queueDealStageChange,
  readDealStatus,
  readPendingAction,
  uniqueStamp,
  type PendingApprovalResponse,
  type ScopedUserFixture,
} from './helpers/mcpFixtures';

/**
 * TC-AI-MCP-APPROVAL-017 — Pending-action visibility and requester revocation.
 * Source: spec `.ai/specs/2026-10-21-mcp-tool-exposure-parity-and-audit.md`.
 *
 * Surfaces under test:
 *   - /api/ai_assistant/ai/actions                  (GET list, per-caller visibility)
 *   - /api/ai_assistant/ai/actions/{id}             (GET, cross-organization approver)
 *   - /api/ai_assistant/ai/actions/{id}/confirm     (POST, cross-organization approver; revoked API key)
 *   - /api/ai_assistant/tools/execute               (POST via x-api-key -> 202 queue)
 *
 * Scenarios:
 *   1. A non-approver lists only their own rows; an approver also lists other
 *      users' MCP / `/tools/execute` rows but never another user's chat rows.
 *      Chat rows are only ever born inside an LLM agent turn, so the chat row is
 *      seeded with the sanctioned DB fixture (`seedPendingActionInDb`, channel
 *      `agent`) instead of a public create route.
 *   2. An approver whose organization differs from the row's gets 404 on the
 *      detail read and on confirm; the record stays unchanged.
 *   3. A write queued through an API key fails approval with
 *      `403 requester_revoked` once that API key is deleted.
 *
 * Mode gating: runs only when the app server was started with
 * `OM_MCP_MUTATION_MODE=approval` (`OM_MCP_MUTATION_MODE=approval yarn test:integration:ephemeral`).
 */

const mutationMode = resolveIntegrationMcpMutationMode();

type PendingActionListBody = {
  items?: Array<{ id: string; channel?: string | null }>;
  total?: number;
};

type OtherOrganizationApprover = {
  organizationId: string;
  roleId: string;
  userId: string;
  token: string;
};

async function listVisibleActionIds(request: APIRequestContext, token: string): Promise<string[]> {
  const query = new URLSearchParams({ toolName: DEAL_MUTATION_TOOL, status: 'pending', pageSize: '100' });
  const response = await apiRequest(request, 'GET', `${ACTIONS_PATH}?${query.toString()}`, { token });
  const body = await readJsonSafe<PendingActionListBody>(response);
  expect(response.status(), `GET ${ACTIONS_PATH} body: ${JSON.stringify(body)}`).toBe(200);
  return (body?.items ?? []).map((item) => item.id);
}

async function createOtherOrganizationApprover(
  request: APIRequestContext,
  adminToken: string,
): Promise<OtherOrganizationApprover> {
  const stamp = uniqueStamp();
  const organizationId = await createOrganizationFixture(request, adminToken, { name: `IT MCP other org ${stamp}` });
  const roleId = await createRoleFixture(request, adminToken, { name: `IT MCP other-org approver ${stamp}` });
  await setRoleAclFeatures(request, adminToken, {
    roleId,
    features: APPROVER_FEATURES,
    organizations: [organizationId],
  });
  const email = `it-mcp-other-org-${stamp}@example.com`;
  const userId = await createUserFixture(request, adminToken, {
    email,
    password: FIXTURE_PASSWORD,
    organizationId,
    roles: [roleId],
  });
  const token = await getAuthToken(request, email, FIXTURE_PASSWORD);
  return { organizationId, roleId, userId, token };
}

test.describe('TC-AI-MCP-APPROVAL-017: pending-action visibility and requester revocation', () => {
  test.skip(mutationMode !== 'approval', 'requires the app server to run with OM_MCP_MUTATION_MODE=approval');

  test('non-approvers list only own rows; approvers see others MCP rows but not their chat rows', async ({ request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    const { tenantId, organizationId } = getTokenScope(adminToken);
    let firstRequester: ScopedUserFixture | null = null;
    let secondRequester: ScopedUserFixture | null = null;
    let approver: ScopedUserFixture | null = null;
    let dealId: string | null = null;
    let firstRowId: string | null = null;
    let secondRowId: string | null = null;
    let chatRowId: string | null = null;

    try {
      firstRequester = await createScopedUser(request, adminToken, { label: 'list-first', features: REQUESTER_FEATURES });
      secondRequester = await createScopedUser(request, adminToken, { label: 'list-second', features: REQUESTER_FEATURES });
      approver = await createScopedUser(request, adminToken, { label: 'list-approver', features: APPROVER_FEATURES });
      dealId = await createOpenDeal(request, adminToken);

      firstRowId = (await queueDealStageChange(request, firstRequester.token, dealId)).pendingActionId;
      secondRowId = (await queueDealStageChange(request, secondRequester.token, dealId)).pendingActionId;
      chatRowId = (
        await seedPendingActionInDb({
          tenantId,
          organizationId,
          createdByUserId: firstRequester.userId,
          toolName: DEAL_MUTATION_TOOL,
          normalizedInput: { dealId, toStage: DEAL_TARGET_STATUS },
        })
      ).id;

      const firstVisible = await listVisibleActionIds(request, firstRequester.token);
      expect(firstVisible).toEqual(expect.arrayContaining([firstRowId, chatRowId]));
      expect(firstVisible, 'a non-approver never lists another user row').not.toContain(secondRowId);

      const secondVisible = await listVisibleActionIds(request, secondRequester.token);
      expect(secondVisible).toContain(secondRowId);
      expect(secondVisible).not.toContain(firstRowId);
      expect(secondVisible).not.toContain(chatRowId);

      const approverVisible = await listVisibleActionIds(request, approver.token);
      expect(approverVisible, 'an approver lists other users MCP rows').toEqual(
        expect.arrayContaining([firstRowId, secondRowId]),
      );
      expect(approverVisible, 'an approver never lists another user chat row').not.toContain(chatRowId);
      expect((await readPendingAction(request, approver.token, chatRowId)).status).toBe(404);
    } finally {
      await deletePendingActionInDb(chatRowId).catch(() => undefined);
      await deletePendingActionInDb(secondRowId).catch(() => undefined);
      await deletePendingActionInDb(firstRowId).catch(() => undefined);
      await deleteDeal(request, adminToken, dealId);
      await deleteScopedUser(request, adminToken, approver);
      await deleteScopedUser(request, adminToken, secondRequester);
      await deleteScopedUser(request, adminToken, firstRequester);
    }
  });

  test('an approver in another organization gets 404 on detail and confirm', async ({ request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    let requester: ScopedUserFixture | null = null;
    let otherApprover: OtherOrganizationApprover | null = null;
    let dealId: string | null = null;
    let pendingActionId: string | null = null;

    try {
      requester = await createScopedUser(request, adminToken, { label: 'org-requester', features: REQUESTER_FEATURES });
      otherApprover = await createOtherOrganizationApprover(request, adminToken);
      dealId = await createOpenDeal(request, adminToken);
      pendingActionId = (await queueDealStageChange(request, requester.token, dealId)).pendingActionId;

      const detail = await readPendingAction(request, otherApprover.token, pendingActionId);
      expect(detail.status, 'cross-organization detail read is 404').toBe(404);

      const confirm = await apiRequest(request, 'POST', `${ACTIONS_PATH}/${pendingActionId}/confirm`, {
        token: otherApprover.token,
        data: {},
      });
      expect(confirm.status(), 'cross-organization confirm is 404').toBe(404);

      expect(await readDealStatus(request, adminToken, dealId)).toBe(DEAL_INITIAL_STATUS);
      expect((await readPendingAction(request, requester.token, pendingActionId)).body?.status).toBe('pending');
    } finally {
      await deletePendingActionInDb(pendingActionId).catch(() => undefined);
      await deleteDeal(request, adminToken, dealId);
      await deleteScopedUser(request, adminToken, requester);
      if (otherApprover) {
        await deleteUserIfExists(request, adminToken, otherApprover.userId);
        await deleteRoleIfExists(request, adminToken, otherApprover.roleId);
        await deleteOrganizationIfExists(request, adminToken, otherApprover.organizationId);
      }
    }
  });

  test('approving a row whose API key was deleted fails with requester_revoked', async ({ request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    const { organizationId } = getTokenScope(adminToken);
    let approver: ScopedUserFixture | null = null;
    let keyRoleId: string | null = null;
    let apiKeyId: string | null = null;
    let dealId: string | null = null;
    let pendingActionId: string | null = null;

    try {
      approver = await createScopedUser(request, adminToken, { label: 'revoked-approver', features: APPROVER_FEATURES });
      keyRoleId = await createRoleFixture(request, adminToken, { name: `IT MCP revoked key ${uniqueStamp()}` });
      await setRoleAclFeatures(request, adminToken, { roleId: keyRoleId, features: REQUESTER_FEATURES, organizations: null });
      const keyResponse = await apiRequest(request, 'POST', '/api/api_keys/keys', {
        token: adminToken,
        data: { name: `it-mcp-revoked-${uniqueStamp()}`, roles: [keyRoleId], organizationId },
      });
      expect(keyResponse.ok(), `API key fixture creation failed: ${keyResponse.status()}`).toBeTruthy();
      const key = await readJsonSafe<{ id?: string; secret?: string }>(keyResponse);
      apiKeyId = key?.id ?? null;
      expect(typeof key?.secret === 'string' && key.secret.length > 0).toBe(true);
      dealId = await createOpenDeal(request, adminToken);

      const queued = await request.fetch(EXECUTE_PATH, {
        method: 'POST',
        headers: { 'x-api-key': key!.secret!, 'Content-Type': 'application/json' },
        data: JSON.stringify({ toolName: DEAL_MUTATION_TOOL, args: { dealId, toStage: DEAL_TARGET_STATUS } }),
      });
      const queuedBody = await readJsonSafe<PendingApprovalResponse>(queued);
      expect(queued.status(), `API key call should queue the write (body: ${JSON.stringify(queuedBody)})`).toBe(202);
      pendingActionId = queuedBody?.pendingActionId ?? null;
      expect(typeof pendingActionId).toBe('string');

      const queuedDetail = await readPendingAction(request, approver.token, pendingActionId!);
      expect(queuedDetail.body?.requester?.apiKeyId).toBe(apiKeyId);

      const deleteKey = await apiRequest(request, 'DELETE', `/api/api_keys/keys?id=${encodeURIComponent(apiKeyId!)}`, {
        token: adminToken,
      });
      expect(deleteKey.ok(), `API key deletion failed: ${deleteKey.status()}`).toBeTruthy();
      apiKeyId = null;

      const confirm = await apiRequest(request, 'POST', `${ACTIONS_PATH}/${pendingActionId}/confirm`, {
        token: approver.token,
        data: {},
      });
      const confirmBody = await readJsonSafe<{ code?: string }>(confirm);
      expect(confirm.status(), `confirm body: ${JSON.stringify(confirmBody)}`).toBe(403);
      expect(confirmBody?.code).toBe('requester_revoked');
      expect(await readDealStatus(request, adminToken, dealId)).toBe(DEAL_INITIAL_STATUS);
    } finally {
      await deletePendingActionInDb(pendingActionId).catch(() => undefined);
      if (apiKeyId) {
        await apiRequest(request, 'DELETE', `/api/api_keys/keys?id=${encodeURIComponent(apiKeyId)}`, {
          token: adminToken,
        }).catch(() => undefined);
      }
      await deleteRoleIfExists(request, adminToken, keyRoleId);
      await deleteDeal(request, adminToken, dealId);
      await deleteScopedUser(request, adminToken, approver);
    }
  });
});
