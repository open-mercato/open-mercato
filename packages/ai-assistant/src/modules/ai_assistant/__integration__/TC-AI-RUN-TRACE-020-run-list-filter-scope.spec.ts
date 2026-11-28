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
import { AGENT_RUNS_API, type AgentRunListBody, createConversationFixture } from './helpers/agentRunChat';

/**
 * TC-AI-RUN-TRACE-020: run list filters only narrow the caller's scope.
 *
 * A `runs.view` caller's `userId` / `conversationId` filters are ANDed with the
 * caller scope on the real database, in both scope shapes: the plain
 * `userId = caller` scope (no readable conversations) and the `$or` scope
 * (caller participates in a conversation). `runs.view_all` filtering is unchanged.
 */
const PASSWORD = 'QaSecret123!';

async function listRunIds(request: APIRequestContext, token: string, query: string): Promise<string[]> {
  const response = await apiRequest(request, 'GET', `${AGENT_RUNS_API}?${query}`, { token });
  expect(response.status(), `GET /ai/runs?${query}`).toBe(200);
  const body = await readJsonSafe<AgentRunListBody>(response);
  return (body?.items ?? []).map((item) => item.id).sort();
}

test.describe('TC-AI-RUN-TRACE-020: run list filter scope', () => {
  test('userId and conversationId filters cannot widen a runs.view scope', async ({ request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    const { tenantId, organizationId, userId: adminId } = getTokenScope(adminToken);
    const stamp = randomUUID().slice(0, 8);
    const agentId = `it_run_filter_scope.agent_${stamp}`;
    const privateConversationId = `it-run-filter-private-${randomUUID()}`;
    const sharedConversationId = `it-run-filter-shared-${randomUUID()}`;
    const viewerEmail = `it-run-filter-viewer-${stamp}@example.com`;
    const viewAllEmail = `it-run-filter-viewall-${stamp}@example.com`;

    let roleId: string | null = null;
    let viewerId: string | null = null;
    let viewAllId: string | null = null;
    const runIds: string[] = [];
    try {
      roleId = await createRoleFixture(request, adminToken, { name: `IT Run Filter Scope Role ${stamp}` });
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

      await createConversationFixture(request, adminToken, {
        agentId,
        conversationId: privateConversationId,
        title: 'Private run filter conversation',
      });
      const adminPrivateRunId = await seedAgentRunInDb({
        tenantId,
        organizationId,
        userId: adminId,
        agentId,
        conversationId: privateConversationId,
      });
      runIds.push(adminPrivateRunId);
      const adminStandaloneRunId = await seedAgentRunInDb({
        tenantId,
        organizationId,
        userId: adminId,
        agentId,
        channel: 'playground',
      });
      runIds.push(adminStandaloneRunId);
      const viewerRunId = await seedAgentRunInDb({
        tenantId,
        organizationId,
        userId: viewerId,
        agentId,
        channel: 'playground',
      });
      runIds.push(viewerRunId);

      const viewerToken = await getAuthToken(request, viewerEmail, PASSWORD);
      const viewAllToken = await getAuthToken(request, viewAllEmail, PASSWORD);
      const agentQuery = `agentId=${encodeURIComponent(agentId)}`;
      const privateQuery = `conversationId=${encodeURIComponent(privateConversationId)}`;

      expect(await listRunIds(request, viewerToken, agentQuery)).toEqual([viewerRunId]);
      expect(await listRunIds(request, viewerToken, `${agentQuery}&userId=${adminId}`)).toEqual([]);
      expect(await listRunIds(request, viewerToken, `${agentQuery}&userId=${viewerId}`)).toEqual([viewerRunId]);
      expect(await listRunIds(request, viewerToken, `${agentQuery}&${privateQuery}`)).toEqual([]);

      await createConversationFixture(request, adminToken, {
        agentId,
        conversationId: sharedConversationId,
        title: 'Shared run filter conversation',
      });
      const adminSharedRunId = await seedAgentRunInDb({
        tenantId,
        organizationId,
        userId: adminId,
        agentId,
        conversationId: sharedConversationId,
      });
      runIds.push(adminSharedRunId);
      const share = await apiRequest(
        request,
        'POST',
        `/api/ai_assistant/ai/conversations/${encodeURIComponent(sharedConversationId)}/participants`,
        { token: adminToken, data: { userId: viewerId } },
      );
      expect(share.status(), 'sharing the conversation with the viewer').toBe(201);

      expect(await listRunIds(request, viewerToken, agentQuery)).toEqual([adminSharedRunId, viewerRunId].sort());
      expect(await listRunIds(request, viewerToken, `${agentQuery}&userId=${adminId}`)).toEqual([adminSharedRunId]);
      expect(await listRunIds(request, viewerToken, `${agentQuery}&${privateQuery}`)).toEqual([]);

      expect(await listRunIds(request, viewAllToken, `${agentQuery}&userId=${adminId}`)).toEqual(
        [adminPrivateRunId, adminStandaloneRunId, adminSharedRunId].sort(),
      );
    } finally {
      await deleteAgentRunsInDb(runIds).catch(() => undefined);
      await deleteConversationCascadeInDb({ tenantId, conversationId: privateConversationId }).catch(() => undefined);
      await deleteConversationCascadeInDb({ tenantId, conversationId: sharedConversationId }).catch(() => undefined);
      for (const userId of [viewerId, viewAllId]) {
        await deleteUserAclInDb(userId ?? '').catch(() => undefined);
        await deleteUserIfExists(request, adminToken, userId);
      }
      await deleteRoleIfExists(request, adminToken, roleId);
    }
  });
});
