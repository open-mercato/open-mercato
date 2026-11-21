import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { deleteUserAclInDb } from '@open-mercato/core/helpers/integration/dbFixtures';
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  deleteAgentRunsInDb,
  deleteConversationCascadeInDb,
  seedAgentRunInDb,
} from './helpers/aiAssistantFixtures';
import {
  AGENT_RUNS_API,
  type AgentRunListBody,
  conversationRunsPath,
  createConversationFixture,
} from './helpers/agentRunChat';

/**
 * TC-AI-RUN-TRACE-017: agent run access rules.
 *
 * Spec `2026-10-21-chat-run-tracing-and-citations` Phase 3. Runs are seeded in
 * the admin's tenant/organization (no LLM needed) and read by fixture users:
 *   - `runs.view` only: own runs + runs of conversations they own, participate
 *     in, or that are organization-visible; anything else is 404 (not 403) so
 *     existence is not revealed. Sharing the conversation grants access.
 *   - `runs.view` + `runs.view_all`: every run of the tenant/organization.
 *   - no `runs.view`: 403 on every runs route.
 */
const PASSWORD = 'Secret123!';

async function listRunIds(request: APIRequestContext, token: string, agentId: string): Promise<string[]> {
  const response = await apiRequest(request, 'GET', `${AGENT_RUNS_API}?agentId=${encodeURIComponent(agentId)}`, {
    token,
  });
  expect(response.status(), 'GET /ai/runs').toBe(200);
  const body = await readJsonSafe<AgentRunListBody>(response);
  return (body?.items ?? []).map((item) => item.id).sort();
}

test.describe('TC-AI-RUN-TRACE-017: agent run access', () => {
  test('runs.view sees own and shared runs, view_all sees all, no feature is 403', async ({ request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    const { tenantId, organizationId, userId: adminId } = getTokenScope(adminToken);
    const stamp = randomUUID().slice(0, 8);
    const agentId = `it_run_access.agent_${stamp}`;
    const conversationId = `it-run-access-${randomUUID()}`;
    const viewerEmail = `it-run-viewer-${stamp}@example.com`;
    const viewAllEmail = `it-run-viewall-${stamp}@example.com`;
    const noRunsEmail = `it-run-noruns-${stamp}@example.com`;

    let roleId: string | null = null;
    let viewerId: string | null = null;
    let viewAllId: string | null = null;
    let noRunsId: string | null = null;
    const runIds: string[] = [];
    try {
      roleId = await createRoleFixture(request, adminToken, { name: `IT Run Access Role ${stamp}` });
      viewerId = await createUserFixture(request, adminToken, {
        email: viewerEmail,
        password: PASSWORD,
        organizationId,
        roles: [roleId],
      });
      viewAllId = await createUserFixture(request, adminToken, {
        email: viewAllEmail,
        password: PASSWORD,
        organizationId,
        roles: [roleId],
      });
      noRunsId = await createUserFixture(request, adminToken, {
        email: noRunsEmail,
        password: PASSWORD,
        organizationId,
        roles: [roleId],
      });
      await setUserAclVisibility(request, adminToken, {
        userId: viewerId,
        features: ['ai_assistant.view', 'ai_assistant.runs.view'],
        organizations: [organizationId],
      });
      await setUserAclVisibility(request, adminToken, {
        userId: viewAllId,
        features: ['ai_assistant.view', 'ai_assistant.runs.view', 'ai_assistant.runs.view_all'],
        organizations: [organizationId],
      });
      await setUserAclVisibility(request, adminToken, {
        userId: noRunsId,
        features: ['ai_assistant.view'],
        organizations: [organizationId],
      });

      await createConversationFixture(request, adminToken, {
        agentId,
        conversationId,
        title: 'Private run access conversation',
      });
      const adminConversationRunId = await seedAgentRunInDb({
        tenantId,
        organizationId,
        userId: adminId,
        agentId,
        conversationId,
      });
      runIds.push(adminConversationRunId);
      const adminStandaloneRunId = await seedAgentRunInDb({
        tenantId,
        organizationId,
        userId: adminId,
        agentId,
        channel: 'playground',
      });
      runIds.push(adminStandaloneRunId);
      const viewerOwnRunId = await seedAgentRunInDb({
        tenantId,
        organizationId,
        userId: viewerId,
        agentId,
        channel: 'playground',
      });
      runIds.push(viewerOwnRunId);

      const viewerToken = await getAuthToken(request, viewerEmail, PASSWORD);
      const viewAllToken = await getAuthToken(request, viewAllEmail, PASSWORD);
      const noRunsToken = await getAuthToken(request, noRunsEmail, PASSWORD);

      expect(await listRunIds(request, viewerToken, agentId)).toEqual([viewerOwnRunId]);
      const viewerOwnDetail = await apiRequest(request, 'GET', `${AGENT_RUNS_API}/${viewerOwnRunId}`, {
        token: viewerToken,
      });
      expect(viewerOwnDetail.status(), 'a runs.view user reads their own run').toBe(200);
      for (const foreignRunId of [adminConversationRunId, adminStandaloneRunId]) {
        const hidden = await apiRequest(request, 'GET', `${AGENT_RUNS_API}/${foreignRunId}`, { token: viewerToken });
        expect(hidden.status(), 'another user\'s private run is 404 for runs.view').toBe(404);
      }
      const hiddenConversation = await apiRequest(request, 'GET', conversationRunsPath(conversationId), {
        token: viewerToken,
      });
      expect(hiddenConversation.status(), 'a private conversation is 404 for a non-participant').toBe(404);

      const everyRun = [adminConversationRunId, adminStandaloneRunId, viewerOwnRunId].sort();
      expect(await listRunIds(request, viewAllToken, agentId)).toEqual(everyRun);
      expect(await listRunIds(request, adminToken, agentId)).toEqual(everyRun);
      const viewAllDetail = await apiRequest(request, 'GET', `${AGENT_RUNS_API}/${adminConversationRunId}`, {
        token: viewAllToken,
      });
      expect(viewAllDetail.status(), 'runs.view_all reads any run in scope').toBe(200);
      const viewAllConversation = await apiRequest(request, 'GET', conversationRunsPath(conversationId), {
        token: viewAllToken,
      });
      expect(viewAllConversation.status()).toBe(200);

      const forbiddenPaths = [
        AGENT_RUNS_API,
        `${AGENT_RUNS_API}/${viewerOwnRunId}`,
        conversationRunsPath(conversationId),
      ];
      for (const path of forbiddenPaths) {
        const response = await apiRequest(request, 'GET', path, { token: noRunsToken });
        expect(response.status(), `GET ${path} without ai_assistant.runs.view`).toBe(403);
      }

      const share = await apiRequest(
        request,
        'POST',
        `/api/ai_assistant/ai/conversations/${encodeURIComponent(conversationId)}/participants`,
        { token: adminToken, data: { userId: viewerId } },
      );
      expect(share.status(), 'sharing the conversation with the viewer').toBe(201);

      const sharedDetail = await apiRequest(request, 'GET', `${AGENT_RUNS_API}/${adminConversationRunId}`, {
        token: viewerToken,
      });
      expect(sharedDetail.status(), 'a participant reads the shared conversation run').toBe(200);
      const sharedConversation = await apiRequest(request, 'GET', conversationRunsPath(conversationId), {
        token: viewerToken,
      });
      expect(sharedConversation.status()).toBe(200);
      const sharedRuns = await readJsonSafe<AgentRunListBody>(sharedConversation);
      expect(sharedRuns?.items.map((item) => item.id)).toEqual([adminConversationRunId]);
      expect(await listRunIds(request, viewerToken, agentId)).toEqual(
        [adminConversationRunId, viewerOwnRunId].sort(),
      );
      const stillHidden = await apiRequest(request, 'GET', `${AGENT_RUNS_API}/${adminStandaloneRunId}`, {
        token: viewerToken,
      });
      expect(stillHidden.status(), 'sharing a conversation does not expose other runs').toBe(404);
    } finally {
      await deleteAgentRunsInDb(runIds).catch(() => undefined);
      await deleteConversationCascadeInDb({ tenantId, conversationId }).catch(() => undefined);
      for (const userId of [viewerId, viewAllId, noRunsId]) {
        await deleteUserAclInDb(userId ?? '').catch(() => undefined);
        await deleteUserIfExists(request, adminToken, userId);
      }
      await deleteRoleIfExists(request, adminToken, roleId);
    }
  });
});
