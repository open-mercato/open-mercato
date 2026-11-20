import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures';
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
 * TC-AI-CITATIONS-020: citations end to end.
 *
 * Spec `2026-10-21-chat-run-tracing-and-citations` Phase 4. Citations are only
 * produced by a tool call during a live LLM turn, so the provider-free cases
 * seed the run row (with `citations`) straight into the DB and import a
 * conversation whose assistant message carries a persisted
 * `ai_assistant:citations` UI part:
 *   - `GET /ai/runs/:id` returns the run citations;
 *   - the run detail page renders them as a Sources section (titles, external
 *     link attributes, in-app links, an unsafe href rendered as plain text);
 *   - a metadata-capture run shows no Sources, even when the API carried some;
 *   - a reloaded conversation renders the persisted citations part (only the
 *     launcher's health/agents probes are stubbed; the transcript is real);
 *   - a real chat turn that calls `search.hybrid_search` persists `record`
 *     citations on its run (skipped when no LLM provider is configured).
 */
const RUNS_PAGE = '/backend/config/ai-assistant/runs';
const CITATIONS_COMPONENT_ID = 'ai_assistant:citations';
const CITATION_KIND = 'it_source';
const LAUNCHER_AGENTS_STUB = {
  agents: [
    {
      id: CHAT_RUN_AGENT_ID,
      moduleId: 'customers',
      label: 'Account assistant',
      description: 'Helps with customer accounts.',
      executionMode: 'chat',
      mutationPolicy: 'read-only',
      allowedTools: [],
      requiredFeatures: [],
      acceptedMediaTypes: [],
      hasOutputSchema: false,
    },
  ],
  total: 1,
  aiConfigured: true,
};

function buildCitations(stamp: string): Array<Record<string, unknown>> {
  return [
    {
      kind: CITATION_KIND,
      ref: `doc-external-${stamp}`,
      label: `External handbook ${stamp}`,
      href: 'https://example.com/handbook',
      quote: 'Refunds are processed within five business days.',
      locator: 'p. 4',
    },
    {
      kind: CITATION_KIND,
      ref: `doc-internal-${stamp}`,
      label: `Internal record ${stamp}`,
      href: '/backend/customers/companies',
    },
    {
      kind: CITATION_KIND,
      ref: `doc-unsafe-${stamp}`,
      label: `Unsafe source ${stamp}`,
      href: 'javascript:alert(1)',
    },
  ];
}

async function expectRenderedCitations(page: Page, scope: string, stamp: string): Promise<void> {
  const section = page.locator(scope).locator('[data-ai-citations]');
  await expect(section).toBeVisible({ timeout: 30_000 });
  await expect(section.locator('li')).toHaveCount(3);

  const external = section.getByRole('link', { name: new RegExp(`External handbook ${stamp}`) });
  await expect(external).toHaveAttribute('href', 'https://example.com/handbook');
  await expect(external).toHaveAttribute('target', '_blank');
  await expect(external).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(section.getByText('p. 4')).toBeVisible();
  await expect(section.getByText('Refunds are processed within five business days.')).toBeVisible();

  const internal = section.getByRole('link', { name: `Internal record ${stamp}` });
  await expect(internal).toHaveAttribute('href', '/backend/customers/companies');
  await expect(internal).not.toHaveAttribute('target', '_blank');

  await expect(section.getByText(`Unsafe source ${stamp}`)).toBeVisible();
  await expect(section.getByRole('link', { name: new RegExp(`Unsafe source ${stamp}`) })).toHaveCount(0);
  await expect(section.locator('a[href^="javascript:"]')).toHaveCount(0);
}

test.describe('TC-AI-CITATIONS-020: citations', () => {
  test('the run detail API returns citations and the page renders them as Sources', async ({ page, request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    const { tenantId, organizationId, userId } = getTokenScope(adminToken);
    const stamp = randomUUID().slice(0, 8);
    const agentId = `it_citations.agent_${stamp}`;
    const citations = buildCitations(stamp);
    let runId: string | null = null;
    try {
      runId = await seedAgentRunInDb({ tenantId, organizationId, userId, agentId, citations });

      const detailResponse = await apiRequest(request, 'GET', `${AGENT_RUNS_API}/${runId}`, { token: adminToken });
      expect(detailResponse.status()).toBe(200);
      const detail = await readJsonSafe<AgentRunDetailBody>(detailResponse);
      expect(detail?.run.citations).toEqual(citations);

      const listResponse = await apiRequest(
        request,
        'GET',
        `${AGENT_RUNS_API}?agentId=${encodeURIComponent(agentId)}`,
        { token: adminToken },
      );
      expect(listResponse.status()).toBe(200);
      const list = await readJsonSafe<{ items: Array<Record<string, unknown>> }>(listResponse);
      expect(list?.items).toHaveLength(1);
      expect(list?.items[0]).not.toHaveProperty('citations');

      await login(page, 'admin');
      await page.goto(`${RUNS_PAGE}/${runId}`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('[data-agent-run-detail]')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('[data-agent-run-sources]').getByRole('heading', { name: 'Sources' })).toBeVisible();
      await expectRenderedCitations(page, '[data-agent-run-sources]', stamp);
    } finally {
      await deleteAgentRunsInDb([runId]).catch(() => undefined);
    }
  });

  test('a metadata-capture run shows no Sources', async ({ page, request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    const { tenantId, organizationId, userId } = getTokenScope(adminToken);
    const stamp = randomUUID().slice(0, 8);
    const agentId = `it_citations.metadata_${stamp}`;
    let runId: string | null = null;
    try {
      runId = await seedAgentRunInDb({
        tenantId,
        organizationId,
        userId,
        agentId,
        captureLevel: 'metadata',
        citations: buildCitations(stamp),
      });

      const detailResponse = await apiRequest(request, 'GET', `${AGENT_RUNS_API}/${runId}`, { token: adminToken });
      expect(detailResponse.status()).toBe(200);
      const detail = await readJsonSafe<AgentRunDetailBody>(detailResponse);
      expect(detail?.run.captureLevel).toBe('metadata');
      expect(detail?.run.citations ?? null).toBeNull();

      await login(page, 'admin');
      await page.route(`**${AGENT_RUNS_API}/${runId}`, async (route) => {
        const response = await route.fetch();
        const body = (await response.json()) as AgentRunDetailBody;
        await route.fulfill({
          response,
          json: { ...body, run: { ...body.run, citations: buildCitations(stamp) } },
        });
      });
      await page.goto(`${RUNS_PAGE}/${runId}`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('[data-agent-run-detail]')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole('heading', { name: agentId })).toBeVisible();
      await expect(page.locator('[data-agent-run-sources]')).toHaveCount(0);
      await expect(page.locator('[data-ai-citations]')).toHaveCount(0);
    } finally {
      await deleteAgentRunsInDb([runId]).catch(() => undefined);
    }
  });

  test('a reloaded conversation renders the persisted citations part', async ({ page, request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    const { tenantId } = getTokenScope(adminToken);
    const stamp = randomUUID().slice(0, 8);
    const conversationId = `it-citations-${randomUUID()}`;
    try {
      const importResponse = await apiRequest(request, 'POST', '/api/ai_assistant/ai/conversations/import', {
        token: adminToken,
        data: {
          conversation: { conversationId, agentId: CHAT_RUN_AGENT_ID, title: `Citations ${stamp}` },
          messages: [
            { clientMessageId: `it-user-${stamp}`, role: 'user', content: 'How fast are refunds processed?' },
            {
              clientMessageId: `it-assistant-${stamp}`,
              role: 'assistant',
              content: 'Refunds take five business days [1].',
              uiParts: [
                {
                  componentId: CITATIONS_COMPONENT_ID,
                  payload: { citations: buildCitations(stamp), title: `Cited sources ${stamp}` },
                },
              ],
            },
          ],
        },
      });
      expect(importResponse.status(), 'POST /ai/conversations/import').toBe(200);

      await login(page, 'admin');
      await page.route('**/api/ai_assistant/health', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ healthy: true }) }),
      );
      await page.route('**/api/ai_assistant/ai/agents', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LAUNCHER_AGENTS_STUB) }),
      );
      await page.goto(`/backend?openAiConversation=${encodeURIComponent(conversationId)}`, {
        waitUntil: 'domcontentloaded',
      });
      const sheet = page.locator('[data-ai-launcher-sheet]');
      await expect(sheet).toBeVisible({ timeout: 30_000 });
      await expect(sheet.getByText('Refunds take five business days [1].')).toBeVisible({ timeout: 30_000 });
      await expect(sheet.getByRole('heading', { name: `Cited sources ${stamp}` })).toBeVisible();
      await expectRenderedCitations(page, '[data-ai-launcher-sheet] [data-role="assistant"]', stamp);
    } finally {
      await deleteConversationCascadeInDb({ tenantId, conversationId }).catch(() => undefined);
    }
  });

  test('a real chat turn that searches persists record citations on its run', async ({ request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    const { tenantId } = getTokenScope(adminToken);
    const stamp = randomUUID().slice(0, 8);
    const companyName = `Citation Probe ${stamp}`;
    const conversationId = `it-citations-live-${randomUUID()}`;
    let companyId: string | null = null;
    try {
      companyId = await createCompanyFixture(request, adminToken, companyName);
      await createConversationFixture(request, adminToken, {
        agentId: CHAT_RUN_AGENT_ID,
        conversationId,
        title: `Citations live ${stamp}`,
      });
      const turn = await sendRealChatTurn(request, adminToken, {
        agentId: CHAT_RUN_AGENT_ID,
        conversationId,
        content: `Call search.hybrid_search with q "${companyName}" and tell me what you found.`,
      });
      test.skip(turn.status !== 200, `No LLM provider configured (chat returned ${turn.status} ${turn.code ?? ''})`);

      const runs = await waitForConversationRuns(request, adminToken, conversationId);
      const detailResponse = await apiRequest(request, 'GET', `${AGENT_RUNS_API}/${runs.items[0].id}`, {
        token: adminToken,
      });
      expect(detailResponse.status()).toBe(200);
      const detail = await readJsonSafe<AgentRunDetailBody>(detailResponse);
      const searchCalls = (detail?.toolCalls ?? []).filter((call) => call.toolName === 'search.hybrid_search');
      test.skip(searchCalls.length === 0, 'The model did not call search.hybrid_search in this turn');
      const hadHits = searchCalls.some((call) => {
        const result = call.result as { totalResults?: number } | null;
        return typeof result?.totalResults === 'number' && result.totalResults > 0;
      });
      test.skip(!hadHits, 'search.hybrid_search returned no hits (search index not ready)');
      if (resolveIntegrationRunTraceCapture() !== 'full') {
        expect(detail?.run.citations ?? null).toBeNull();
        return;
      }
      const citations = detail?.run.citations ?? [];
      expect(citations.length).toBeGreaterThan(0);
      expect(citations.length).toBeLessThanOrEqual(50);
      for (const citation of citations) {
        expect(citation.kind).toBe('record');
        expect(String(citation.ref)).toContain(':');
      }
    } finally {
      await deleteConversationAgentRunsInDb({ tenantId, conversationId }).catch(() => undefined);
      await deleteConversationCascadeInDb({ tenantId, conversationId }).catch(() => undefined);
      await deleteEntityIfExists(request, adminToken, '/api/customers/companies', companyId);
    }
  });
});
