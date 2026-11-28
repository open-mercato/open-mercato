import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  SEEDED_AGENT_RUN_DEFINITION_HASH,
  deleteAgentRunsInDb,
  deleteConversationAgentRunsInDb,
  deleteConversationCascadeInDb,
  deletePromptOverrideVersionInDb,
  seedAgentRunInDb,
} from './helpers/aiAssistantFixtures';
import {
  AGENT_RUNS_API,
  CHAT_RUN_AGENT_ID,
  type AgentRunDetailBody,
  type AgentRunListBody,
  conversationRunsPath,
  createConversationFixture,
  sendRealChatTurn,
  waitForConversationRuns,
} from './helpers/agentRunChat';

/**
 * TC-AI-RUN-TRACE-015: chat runs read API (`/ai/runs`, `/ai/runs/:id`,
 * `/ai/conversations/:conversationId/runs`).
 *
 * Spec `2026-10-21-chat-run-tracing-and-citations` Phase 3. A run row is only
 * ever recorded after a live LLM turn, so the provider-free cases seed the run
 * (with a step and a tool call) straight into the DB and drive the read API.
 * The end-to-end case — a real chat turn with a prompt override — runs only
 * when an LLM provider is configured and is skipped otherwise.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

test.describe('TC-AI-RUN-TRACE-015: conversation runs and run detail', () => {
  test('a conversation run lists once and its detail carries the tool call trace', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin');
    const { tenantId, organizationId, userId } = getTokenScope(adminToken);
    const stamp = randomUUID().slice(0, 8);
    const agentId = `it_run_trace.agent_${stamp}`;
    const conversationId = `it-run-trace-${randomUUID()}`;
    let runId: string | null = null;
    try {
      await createConversationFixture(request, adminToken, {
        agentId,
        conversationId,
        title: 'Run trace conversation',
      });
      runId = await seedAgentRunInDb({
        tenantId,
        organizationId,
        userId,
        agentId,
        conversationId,
        modelId: 'it-model-015',
        promptOverrideVersion: 3,
        toolCalls: [
          {
            toolName: 'customers.list_people',
            argKeys: ['query', 'limit'],
            args: { query: 'Ada', limit: 5 },
            result: { items: [{ id: 'person-1', name: 'Ada Lovelace' }], total: 1 },
          },
        ],
      });

      const listResponse = await apiRequest(request, 'GET', conversationRunsPath(conversationId), {
        token: adminToken,
      });
      expect(listResponse.status()).toBe(200);
      const list = await readJsonSafe<AgentRunListBody>(listResponse);
      expect(list?.total).toBe(1);
      expect(list?.items).toHaveLength(1);
      expect(list?.items[0].id).toBe(runId);
      expect(list?.items[0].conversationId).toBe(conversationId);
      expect(list?.items[0].toolCallCount).toBe(1);
      expect(list?.items[0]).not.toHaveProperty('inputText');
      expect(list?.items[0]).not.toHaveProperty('outputText');

      const detailResponse = await apiRequest(request, 'GET', `${AGENT_RUNS_API}/${runId}`, {
        token: adminToken,
      });
      expect(detailResponse.status()).toBe(200);
      const detail = await readJsonSafe<AgentRunDetailBody>(detailResponse);
      expect(detail?.run.modelId).toBe('it-model-015');
      expect(detail?.run.promptOverrideVersion).toBe(3);
      expect(detail?.run.agentDefinitionHash).toBe(SEEDED_AGENT_RUN_DEFINITION_HASH);
      expect(detail?.run.channel).toBe('chat');
      expect(detail?.links.conversationId).toBe(conversationId);
      expect(detail?.steps).toHaveLength(1);
      expect(detail?.toolCalls).toHaveLength(1);
      const toolCall = detail?.toolCalls[0];
      expect(toolCall?.toolName).toBe('customers.list_people');
      expect(toolCall?.argKeys).toEqual(['query', 'limit']);
      expect(toolCall?.args).toEqual({ query: 'Ada', limit: 5 });
      expect(toolCall?.result).toEqual({ items: [{ id: 'person-1', name: 'Ada Lovelace' }], total: 1 });

      const filteredResponse = await apiRequest(
        request,
        'GET',
        `${AGENT_RUNS_API}?agentId=${encodeURIComponent(agentId)}&channel=chat&status=completed`,
        { token: adminToken },
      );
      expect(filteredResponse.status()).toBe(200);
      const filtered = await readJsonSafe<AgentRunListBody>(filteredResponse);
      expect(filtered?.items.map((item) => item.id)).toEqual([runId]);
    } finally {
      await deleteAgentRunsInDb([runId]).catch(() => undefined);
      await deleteConversationCascadeInDb({ tenantId, conversationId }).catch(() => undefined);
    }
  });

  test('the runs routes reject unauthenticated callers with 401', async ({ request }) => {
    const paths = [AGENT_RUNS_API, `${AGENT_RUNS_API}/${randomUUID()}`, conversationRunsPath(`it-${randomUUID()}`)];
    for (const path of paths) {
      const response = await request.get(path);
      expect(response.status(), `GET ${path} without auth`).toBe(401);
    }
  });

  test('invalid query parameters and run ids return 400', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin');
    const invalidQueries = [
      'pageSize=500',
      'page=0',
      'channel=not-a-channel',
      'status=not-a-status',
      'userId=not-a-uuid',
      'from=2026-02-01T00:00:00.000Z&to=2026-01-01T00:00:00.000Z',
    ];
    for (const query of invalidQueries) {
      const response = await apiRequest(request, 'GET', `${AGENT_RUNS_API}?${query}`, { token: adminToken });
      expect(response.status(), `GET /ai/runs?${query}`).toBe(400);
      expect((await readJsonSafe<{ code?: string }>(response))?.code).toBe('validation_error');
    }
    const badId = await apiRequest(request, 'GET', `${AGENT_RUNS_API}/not-a-uuid`, { token: adminToken });
    expect(badId.status()).toBe(400);
    expect((await readJsonSafe<{ code?: string }>(badId))?.code).toBe('validation_error');
  });

  test('an unknown run id and an unknown conversation return 404', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin');
    const unknownRun = await apiRequest(request, 'GET', `${AGENT_RUNS_API}/${randomUUID()}`, { token: adminToken });
    expect(unknownRun.status()).toBe(404);
    expect((await readJsonSafe<{ code?: string }>(unknownRun))?.code).toBe('agent_run_not_found');
    const unknownConversation = await apiRequest(
      request,
      'GET',
      conversationRunsPath(`it-missing-${randomUUID()}`),
      { token: adminToken },
    );
    expect(unknownConversation.status()).toBe(404);
    expect((await readJsonSafe<{ code?: string }>(unknownConversation))?.code).toBe('conversation_not_found');
  });

  test('a real chat turn records one run with its prompt override version', async ({ request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    const { tenantId } = getTokenScope(adminToken);
    const conversationId = `it-run-trace-real-${randomUUID()}`;
    const promptOverridePath = `/api/ai_assistant/ai/agents/${encodeURIComponent(CHAT_RUN_AGENT_ID)}/prompt-override`;
    let overrideVersion: number | null = null;
    try {
      const overrideResponse = await apiRequest(request, 'POST', promptOverridePath, {
        token: adminToken,
        data: { sections: { tone: 'Answer in one short sentence.' } },
      });
      expect(overrideResponse.status()).toBe(200);
      overrideVersion = (await readJsonSafe<{ version?: number }>(overrideResponse))?.version ?? null;
      expect(typeof overrideVersion).toBe('number');
      await createConversationFixture(request, adminToken, {
        agentId: CHAT_RUN_AGENT_ID,
        conversationId,
        title: 'Run trace real turn',
      });

      const turn = await sendRealChatTurn(request, adminToken, {
        agentId: CHAT_RUN_AGENT_ID,
        conversationId,
        content: 'Use your tools to search customers named "Integration" and tell me how many you found.',
      });
      test.skip(
        turn.status !== 200,
        `chat did not stream (status ${turn.status}, code ${turn.code ?? ''}); no LLM provider in this environment`,
      );

      const runs = await waitForConversationRuns(request, adminToken, conversationId);
      expect(runs.items).toHaveLength(1);
      const run = runs.items[0];
      expect(run.id).toMatch(UUID_PATTERN);
      expect(run.channel).toBe('chat');

      const detailResponse = await apiRequest(request, 'GET', `${AGENT_RUNS_API}/${run.id}`, { token: adminToken });
      expect(detailResponse.status()).toBe(200);
      const detail = await readJsonSafe<AgentRunDetailBody>(detailResponse);
      expect(detail?.run.modelId).toBeTruthy();
      expect(detail?.run.agentDefinitionHash).toBeTruthy();
      expect(detail?.run.promptOverrideVersion).toBe(overrideVersion);
      for (const toolCall of detail?.toolCalls ?? []) {
        expect(toolCall.args).not.toBeNull();
        expect(toolCall.result).not.toBeNull();
      }
    } finally {
      await deleteConversationAgentRunsInDb({ tenantId, conversationId }).catch(() => undefined);
      await deleteConversationCascadeInDb({ tenantId, conversationId }).catch(() => undefined);
      await deletePromptOverrideVersionInDb({
        tenantId,
        agentId: CHAT_RUN_AGENT_ID,
        version: overrideVersion,
      }).catch(() => undefined);
    }
  });
});
