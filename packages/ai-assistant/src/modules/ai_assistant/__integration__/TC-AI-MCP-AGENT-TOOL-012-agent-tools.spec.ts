import { test, expect, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { EXECUTE_PATH, TOOLS_PATH } from './helpers/mcpFixtures';

/**
 * TC-AI-MCP-AGENT-TOOL-012 — Agent tools: exposure view, unavailable agents, unknown agents.
 * Source: spec `.ai/specs/2026-10-21-mcp-tool-exposure-parity-and-audit.md` (Phase 4 — agent as one tool).
 *
 * Surfaces under test:
 *   - /api/ai_assistant/tools?view=mcp   (GET, MCP exposure view)
 *   - /api/ai_assistant/tools/execute    (POST, agent tool whose agent cannot run)
 *   - /api/ai_assistant/ai/run-object    (POST, unknown agent)
 *
 * Harness limitation: there is no scripted LLM provider, so the spec's
 * "`tools/call` returns `structuredContent.result`" case cannot run here — the
 * structured payload is covered by the unit suites (`mcp-agent-tool-results`,
 * `http-server.*`, `agent-tool`) and, against a real orchestrator agent, by the
 * model-gated `TC-AO-MCP-DISPATCH-001` in the agent orchestrator module. No OSS
 * module ships an agent tool, so the agent-specific sub-cases run only when the
 * app under test registers one and skip with a reason otherwise.
 *
 * No records are created, so there is nothing to clean up.
 */

const RUN_OBJECT_PATH = '/api/ai_assistant/ai/run-object';
const MUTATION_MODES = ['direct', 'deny', 'approval'];
const HIDDEN_REASONS = ['expose_false', 'denylist', 'not_allowlisted', 'mutation_mode', 'agent_tools_off', 'agent_unavailable'];

type ExposureTool = {
  name?: unknown;
  module?: unknown;
  exposed?: unknown;
  hiddenReason?: unknown;
  isMutation?: unknown;
  agentRef?: { agentId?: unknown; engine?: unknown } | null;
};

type ExposureView = {
  mutationMode?: unknown;
  allowlist?: unknown;
  denylist?: unknown;
  agentToolsEnabled?: unknown;
  tools?: ExposureTool[];
};

async function readExposureView(request: APIRequestContext, token: string): Promise<ExposureView> {
  const response = await apiRequest(request, 'GET', `${TOOLS_PATH}?view=mcp`, { token });
  expect(response.status(), 'GET /api/ai_assistant/tools?view=mcp should return 200').toBe(200);
  const body = await readJsonSafe<ExposureView>(response);
  expect(body, 'exposure view body').toBeTruthy();
  return body!;
}

test.describe('TC-AI-MCP-AGENT-TOOL-012: agent tools', () => {
  test('the MCP exposure view has the documented shape and marks agent tools with agentRef', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin');
    const view = await readExposureView(request, token);

    expect(MUTATION_MODES).toContain(view.mutationMode);
    expect(view.allowlist === null || Array.isArray(view.allowlist)).toBe(true);
    expect(Array.isArray(view.denylist)).toBe(true);
    expect(typeof view.agentToolsEnabled).toBe('boolean');
    expect(Array.isArray(view.tools)).toBe(true);
    expect(view.tools!.length).toBeGreaterThan(0);

    for (const tool of view.tools!) {
      const label = String(tool.name);
      expect(typeof tool.name).toBe('string');
      expect(typeof tool.module).toBe('string');
      expect(typeof tool.exposed).toBe('boolean');
      expect(typeof tool.isMutation).toBe('boolean');
      expect(tool.exposed, `${label}: exposed iff no hiddenReason`).toBe(tool.hiddenReason === null);
      if (tool.hiddenReason !== null) expect(HIDDEN_REASONS).toContain(tool.hiddenReason);
      if (tool.agentRef) {
        expect(typeof tool.agentRef.agentId, `${label}: agentRef.agentId`).toBe('string');
        expect(typeof tool.agentRef.engine, `${label}: agentRef.engine`).toBe('string');
      } else {
        expect(tool.agentRef, `${label}: non-agent tools carry agentRef null`).toBeNull();
        expect(['agent_tools_off', 'agent_unavailable']).not.toContain(tool.hiddenReason);
      }
    }

    const names = view.tools!.map((tool) => String(tool.name));
    expect([...names].sort((left, right) => left.localeCompare(right)), 'tools are sorted by name').toEqual(names);

    const agentTools = view.tools!.filter((tool) => tool.agentRef);
    if (!view.agentToolsEnabled) {
      for (const tool of agentTools) expect(tool.hiddenReason).toBe('agent_tools_off');
    }
  });

  test('an unsupported view value is rejected with 400', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin');
    const response = await apiRequest(request, 'GET', `${TOOLS_PATH}?view=not-a-view`, { token });
    expect(response.status()).toBe(400);
  });

  test('an agent tool whose agent cannot run fails with the dispatcher-unavailable error', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin');
    const view = await readExposureView(request, token);
    const unavailable = (view.tools ?? []).find((tool) => tool.agentRef && tool.hiddenReason === 'agent_unavailable');
    test.skip(
      !unavailable,
      view.agentToolsEnabled
        ? 'no registered agent tool points at an unavailable agent in this app (every agent tool is runnable or none is registered)'
        : 'agent tools are disabled (OM_MCP_AGENT_TOOLS off), so the view cannot tell which agent tools are unavailable',
    );

    const toolName = String(unavailable!.name);
    const response = await apiRequest(request, 'POST', EXECUTE_PATH, {
      token,
      data: { toolName, args: {} },
    });
    const body = await readJsonSafe<{ success?: boolean; error?: string }>(response);
    expect(response.status(), JSON.stringify(body)).toBe(400);
    expect(body?.success).toBe(false);
    expect(body?.error ?? '').toContain('its agent is not available');
  });

  test('run-object with an unknown agent answers 404 agent_unknown', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin');
    const response = await apiRequest(request, 'POST', RUN_OBJECT_PATH, {
      token,
      data: {
        agent: 'qa_missing_module.qa_missing_agent_tool',
        messages: [{ role: 'user', content: 'Hello.' }],
      },
    });
    expect(response.status()).toBe(404);
    const body = await readJsonSafe<{ code?: string; agentRunId?: unknown }>(response);
    expect(body?.code).toBe('agent_unknown');
    expect(body?.agentRunId).toBeUndefined();
  });
});
