import { expect, type APIRequestContext } from '@playwright/test';
import { apiRequest } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';

export const CHAT_RUN_AGENT_ID = 'customers.account_assistant';

export const AGENT_RUNS_API = '/api/ai_assistant/ai/runs';

export const CONVERSATIONS_API = '/api/ai_assistant/ai/conversations';

export type AgentRunListItem = {
  id: string;
  agentId: string;
  channel: string;
  status: string;
  modelId: string;
  conversationId: string | null;
  userId: string | null;
  captureLevel: 'full' | 'metadata';
  toolCallCount: number;
};

export type AgentRunListBody = {
  items: AgentRunListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type AgentRunToolCall = {
  toolName: string;
  argKeys: string[];
  args: unknown;
  result: unknown;
};

export type AgentRunDetailBody = {
  run: AgentRunListItem & {
    agentDefinitionHash: string;
    promptOverrideVersion: number | null;
    inputText: string | null;
    outputText: string | null;
  };
  steps: Array<{ stepIndex: number; text: string | null }>;
  toolCalls: AgentRunToolCall[];
  links: { conversationId: string | null; pendingActionIds: string[] };
};

export function conversationRunsPath(conversationId: string): string {
  return `${CONVERSATIONS_API}/${encodeURIComponent(conversationId)}/runs`;
}

export async function createConversationFixture(
  request: APIRequestContext,
  token: string,
  input: { agentId: string; conversationId: string; title: string },
): Promise<void> {
  const response = await apiRequest(request, 'POST', CONVERSATIONS_API, { token, data: input });
  expect(response.status(), 'POST /ai/conversations should return 201').toBe(201);
}

/**
 * Sends one real chat turn and drains the SSE stream. Returns the HTTP status so
 * callers can `test.skip` when no LLM provider is configured (the dispatcher
 * fails before streaming).
 */
export async function sendRealChatTurn(
  request: APIRequestContext,
  token: string,
  input: { agentId: string; conversationId: string; content: string },
): Promise<{ status: number; code: string | null }> {
  const response = await apiRequest(
    request,
    'POST',
    `/api/ai_assistant/ai/chat?agent=${encodeURIComponent(input.agentId)}`,
    {
      token,
      timeout: 120_000,
      data: {
        conversationId: input.conversationId,
        messages: [{ role: 'user', content: input.content }],
      },
    },
  );
  if (response.status() !== 200) {
    const body = await readJsonSafe<{ code?: string }>(response);
    return { status: response.status(), code: body?.code ?? null };
  }
  await response.body();
  return { status: 200, code: null };
}

/** Polls the conversation runs endpoint until the recorder has persisted a run. */
export async function waitForConversationRuns(
  request: APIRequestContext,
  token: string,
  conversationId: string,
): Promise<AgentRunListBody> {
  let latest: AgentRunListBody | null = null;
  await expect
    .poll(
      async () => {
        const response = await apiRequest(request, 'GET', conversationRunsPath(conversationId), { token });
        if (response.status() !== 200) return 0;
        latest = await readJsonSafe<AgentRunListBody>(response);
        return latest?.items.length ?? 0;
      },
      { timeout: 30_000, message: 'the agent run should be recorded for the conversation' },
    )
    .toBeGreaterThan(0);
  if (!latest) throw new Error('[internal] conversation runs were not loaded');
  return latest;
}
