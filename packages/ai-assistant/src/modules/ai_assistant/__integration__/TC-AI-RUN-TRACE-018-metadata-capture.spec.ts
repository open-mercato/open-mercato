import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  deleteAgentRunsInDb,
  deleteConversationAgentRunsInDb,
  deleteConversationCascadeInDb,
  resolveIntegrationRunTraceCapture,
  seedAgentRunInDb,
} from './helpers/aiAssistantFixtures';
import {
  AGENT_RUNS_API,
  CHAT_RUN_AGENT_ID,
  type AgentRunDetailBody,
  createConversationFixture,
  sendRealChatTurn,
  waitForConversationRuns,
} from './helpers/agentRunChat';

/**
 * TC-AI-RUN-TRACE-018: `OM_AI_RUN_TRACE_CAPTURE=metadata`.
 *
 * Spec `2026-10-21-chat-run-tracing-and-citations` Phase 3. With metadata
 * capture the recorder stores no tool `args` / `result` and no input, output or
 * step text — only shapes such as `argKeys`.
 *   - provider-free: a metadata-capture run (seeded) is served by the detail API
 *     with null content and its `argKeys`, and the detail page explains that the
 *     content was not captured;
 *   - recorder: a real chat turn under `OM_AI_RUN_TRACE_CAPTURE=metadata` stores
 *     no content. It needs both that env toggle on the app server and an LLM
 *     provider, so it is skipped otherwise.
 */
test.describe('TC-AI-RUN-TRACE-018: metadata-only run capture', () => {
  test('a metadata-capture run exposes argKeys but no content', async ({ page, request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    const { tenantId, organizationId, userId } = getTokenScope(adminToken);
    const agentId = `it_run_capture.agent_${randomUUID().slice(0, 8)}`;
    let runId: string | null = null;
    try {
      runId = await seedAgentRunInDb({
        tenantId,
        organizationId,
        userId,
        agentId,
        captureLevel: 'metadata',
        toolCalls: [
          {
            toolName: 'customers.get_person',
            argKeys: ['personId', 'includeDeals'],
            args: { personId: 'person-1', includeDeals: true },
            result: { id: 'person-1' },
          },
        ],
      });

      const response = await apiRequest(request, 'GET', `${AGENT_RUNS_API}/${runId}`, { token: adminToken });
      expect(response.status()).toBe(200);
      const detail = await readJsonSafe<AgentRunDetailBody>(response);
      expect(detail?.run.captureLevel).toBe('metadata');
      expect(detail?.run.inputText).toBeNull();
      expect(detail?.run.outputText).toBeNull();
      expect(detail?.steps.every((step) => step.text === null)).toBe(true);
      expect(detail?.toolCalls).toHaveLength(1);
      expect(detail?.toolCalls[0].argKeys).toEqual(['personId', 'includeDeals']);
      expect(detail?.toolCalls[0].args).toBeNull();
      expect(detail?.toolCalls[0].result).toBeNull();

      await login(page, 'admin');
      await page.goto(`/backend/config/ai-assistant/runs/${runId}`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('[data-agent-run-detail]')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('[data-agent-run-content-not-captured]')).toBeVisible();
      await page.getByRole('button', { name: /Step 1/ }).click();
      await expect(page.getByText('customers.get_person').first()).toBeVisible();
    } finally {
      await deleteAgentRunsInDb([runId]).catch(() => undefined);
    }
  });

  test('a real chat turn under metadata capture stores no content', async ({ request }) => {
    test.slow();
    const captureLevel = resolveIntegrationRunTraceCapture();
    test.skip(
      captureLevel !== 'metadata',
      `the app server runs with OM_AI_RUN_TRACE_CAPTURE=${captureLevel}; set it to "metadata" to cover the recorder`,
    );
    const adminToken = await getAuthToken(request, 'admin');
    const { tenantId } = getTokenScope(adminToken);
    const conversationId = `it-run-capture-real-${randomUUID()}`;
    try {
      await createConversationFixture(request, adminToken, {
        agentId: CHAT_RUN_AGENT_ID,
        conversationId,
        title: 'Run capture real turn',
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
      const response = await apiRequest(request, 'GET', `${AGENT_RUNS_API}/${runs.items[0].id}`, {
        token: adminToken,
      });
      expect(response.status()).toBe(200);
      const detail = await readJsonSafe<AgentRunDetailBody>(response);
      expect(detail?.run.captureLevel).toBe('metadata');
      expect(detail?.run.inputText).toBeNull();
      expect(detail?.run.outputText).toBeNull();
      expect(detail?.steps.every((step) => step.text === null)).toBe(true);
      for (const toolCall of detail?.toolCalls ?? []) {
        expect(toolCall.args).toBeNull();
        expect(toolCall.result).toBeNull();
        expect(Array.isArray(toolCall.argKeys)).toBe(true);
      }
    } finally {
      await deleteConversationAgentRunsInDb({ tenantId, conversationId }).catch(() => undefined);
      await deleteConversationCascadeInDb({ tenantId, conversationId }).catch(() => undefined);
    }
  });
});
