import { test, expect, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createRoleFixture,
  deleteRoleIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  DEAL_MUTATION_TOOL,
  DEAL_READ_TOOL,
  EXECUTE_PATH,
  TOOLS_PATH,
  uniqueStamp,
} from './helpers/mcpFixtures';

/**
 * TC-AI-MCP-PARITY-011 — Agent and MCP surfaces expose the same tools for one role.
 * Source: spec `.ai/specs/2026-10-21-mcp-tool-exposure-parity-and-audit.md`.
 *
 * Surfaces under test:
 *   - /api/ai_assistant/ai/agents         (GET, x-api-key principal)
 *   - /api/ai_assistant/tools             (GET, x-api-key principal, plain and `view=mcp`)
 *   - /api/ai_assistant/tools/execute     (POST, x-api-key principal, read agent tool)
 *   - /api/ai_assistant/ai/run-object     (POST, x-api-key principal)
 *
 * An API key bound to a role with only `ai_assistant.view` + `customers.deals.view`
 * can invoke `customers.deal_analyzer`. The agent's reachable tools (its
 * `allowedTools` narrowed by the caller's features) must equal the MCP exposure
 * view filtered to the same `allowedTools`. An agent whose `requiredFeatures`
 * the role lacks is absent from `/ai/agents`, its agent tool (when the app
 * registers one) is absent from both tool listings and refused on direct
 * execution, and `/ai/run-object` refuses it with 403 `agent_features_denied`.
 *
 * Harness limitation: the MCP HTTP server (`mcp:serve-http`) is a separate
 * process the integration harness does not start; `GET /api/ai_assistant/tools`
 * (plain and `view=mcp`) applies the same per-caller ACL filter and exposure
 * rules and stands in for `tools/list` (see TC-AI-MCP-EXPOSURE-010). The agent
 * tool is never invoked successfully, so no LLM provider is needed. Mutation
 * tools are not used for ACL denial: since #8304 `/tools/execute` refuses every
 * mutation tool before the ACL check.
 */

const AGENTS_PATH = '/api/ai_assistant/ai/agents';
const RUN_OBJECT_PATH = '/api/ai_assistant/ai/run-object';
const PARITY_AGENT_ID = 'customers.deal_analyzer';
const FALLBACK_DENIED_AGENT_ID = 'customers.account_assistant';
const ROLE_FEATURES = ['ai_assistant.view', 'customers.deals.view'];

type AgentSummary = {
  id: string;
  allowedTools?: string[];
  requiredFeatures?: string[];
};

type ExposureTool = {
  name: string;
  exposed: boolean;
  hiddenReason: string | null;
  isMutation: boolean;
  agentRef: { agentId: string; engine: string } | null;
};

async function listAgents(request: APIRequestContext, headers: Record<string, string>): Promise<AgentSummary[]> {
  const response = await request.fetch(AGENTS_PATH, { method: 'GET', headers });
  expect(response.status(), 'GET /api/ai_assistant/ai/agents should return 200').toBe(200);
  const body = await readJsonSafe<{ agents?: AgentSummary[] }>(response);
  expect(Array.isArray(body?.agents)).toBe(true);
  return body?.agents ?? [];
}

async function listToolNames(request: APIRequestContext, headers: Record<string, string>): Promise<string[]> {
  const response = await request.fetch(TOOLS_PATH, { method: 'GET', headers });
  expect(response.status(), 'GET /api/ai_assistant/tools should return 200').toBe(200);
  const body = await readJsonSafe<{ tools?: Array<{ name: string }> }>(response);
  expect(Array.isArray(body?.tools)).toBe(true);
  return (body?.tools ?? []).map((tool) => tool.name);
}

async function listExposure(request: APIRequestContext, headers: Record<string, string>): Promise<ExposureTool[]> {
  const response = await request.fetch(`${TOOLS_PATH}?view=mcp`, { method: 'GET', headers });
  expect(response.status(), 'GET /api/ai_assistant/tools?view=mcp should return 200').toBe(200);
  const body = await readJsonSafe<{ tools?: ExposureTool[] }>(response);
  expect(Array.isArray(body?.tools)).toBe(true);
  return body?.tools ?? [];
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function holdsAll(required: string[] | undefined, granted: string[]): boolean {
  return (required ?? []).every((feature) => granted.includes(feature));
}

test.describe('TC-AI-MCP-PARITY-011: agent vs MCP tool parity', () => {
  test('agent-reachable tools match the MCP view and an unpermitted agent is hidden and denied', async ({ request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'superadmin');
    const adminHeaders = { Authorization: `Bearer ${adminToken}` };
    const { organizationId } = getTokenScope(adminToken);
    let roleId: string | null = null;
    let apiKeyId: string | null = null;

    try {
      roleId = await createRoleFixture(request, adminToken, { name: `IT MCP parity ${uniqueStamp()}` });
      await setRoleAclFeatures(request, adminToken, { roleId, features: ROLE_FEATURES, organizations: null });

      const keyResponse = await apiRequest(request, 'POST', '/api/api_keys/keys', {
        token: adminToken,
        data: { name: `it-mcp-parity-${uniqueStamp()}`, roles: [roleId], organizationId },
      });
      expect(keyResponse.ok(), `API key fixture creation failed: ${keyResponse.status()}`).toBeTruthy();
      const key = await readJsonSafe<{ id?: string; secret?: string }>(keyResponse);
      apiKeyId = key?.id ?? null;
      expect(typeof key?.secret === 'string' && key.secret.length > 0).toBe(true);
      const keyHeaders = { 'x-api-key': key!.secret!, 'Content-Type': 'application/json' };

      const adminAgents = await listAgents(request, adminHeaders);
      const keyAgents = await listAgents(request, keyHeaders);
      const keyToolNames = new Set(await listToolNames(request, keyHeaders));
      const keyExposure = await listExposure(request, keyHeaders);
      const adminExposure = await listExposure(request, adminHeaders);

      const parityAgent = keyAgents.find((agent) => agent.id === PARITY_AGENT_ID);
      expect(parityAgent, `${PARITY_AGENT_ID} is invocable by a role holding its requiredFeatures`).toBeTruthy();
      const allowedTools = new Set(parityAgent!.allowedTools ?? []);
      expect(allowedTools.has(DEAL_READ_TOOL)).toBe(true);
      expect(allowedTools.has(DEAL_MUTATION_TOOL)).toBe(true);

      const agentReachable = sorted([...allowedTools].filter((name) => keyToolNames.has(name)));
      const mcpForAgent = keyExposure.filter((tool) => allowedTools.has(tool.name));
      expect(sorted(mcpForAgent.map((tool) => tool.name)), 'MCP view filtered to the agent tools equals the agent-reachable set').toEqual(
        agentReachable,
      );
      expect(agentReachable).toContain(DEAL_READ_TOOL);
      expect(agentReachable, 'tool requiring customers.deals.manage is unreachable on both surfaces').not.toContain(DEAL_MUTATION_TOOL);
      const adminAllowed = adminExposure.filter((tool) => allowedTools.has(tool.name)).map((tool) => tool.name);
      expect(adminAllowed.length, 'the role narrows the agent tool set').toBeGreaterThan(agentReachable.length);
      const readTool = mcpForAgent.find((tool) => tool.name === DEAL_READ_TOOL);
      expect(readTool?.exposed, `${DEAL_READ_TOOL} is exposed over MCP`).toBe(true);
      for (const tool of mcpForAgent) {
        expect(tool.exposed, `${tool.name}: exposed iff no hiddenReason`).toBe(tool.hiddenReason === null);
        if (!tool.exposed) expect(tool.isMutation || tool.hiddenReason !== 'mutation_mode').toBe(true);
      }

      const exposedAgentTool = adminExposure.find(
        (tool) =>
          tool.agentRef &&
          !holdsAll(adminAgents.find((agent) => agent.id === tool.agentRef!.agentId)?.requiredFeatures, ROLE_FEATURES),
      );
      const deniedAgentId =
        exposedAgentTool?.agentRef?.agentId ??
        adminAgents.find((agent) => agent.id === FALLBACK_DENIED_AGENT_ID)?.id ??
        null;
      expect(deniedAgentId, 'an agent whose requiredFeatures the role lacks is registered').toBeTruthy();

      const deniedAgent = adminAgents.find((agent) => agent.id === deniedAgentId);
      if (deniedAgent) {
        expect(holdsAll(deniedAgent.requiredFeatures, ROLE_FEATURES), `${deniedAgentId} requires a feature the role lacks`).toBe(false);
        expect(keyAgents.map((agent) => agent.id), `${deniedAgentId} is absent from the role's agent list`).not.toContain(deniedAgentId);
      }

      const runResponse = await request.fetch(RUN_OBJECT_PATH, {
        method: 'POST',
        headers: keyHeaders,
        data: JSON.stringify({ agent: deniedAgentId, messages: [{ role: 'user', content: 'Hello.' }] }),
      });
      const runBody = await readJsonSafe<{ code?: string; agentRunId?: unknown }>(runResponse);
      expect(runResponse.status(), `run-object for ${deniedAgentId}: ${JSON.stringify(runBody)}`).toBe(403);
      expect(runBody?.code).toBe('agent_features_denied');
      expect(runBody?.agentRunId).toBeUndefined();

      if (exposedAgentTool) {
        const toolName = exposedAgentTool.name;
        expect(keyToolNames.has(toolName), `${toolName} is absent from the role's tool list`).toBe(false);
        expect(keyExposure.map((tool) => tool.name), `${toolName} is absent from the role's MCP view`).not.toContain(toolName);
        const executeResponse = await request.fetch(EXECUTE_PATH, {
          method: 'POST',
          headers: keyHeaders,
          data: JSON.stringify({ toolName, args: {} }),
        });
        const executeBody = await readJsonSafe<{ success?: boolean; error?: string }>(executeResponse);
        expect(executeResponse.status(), `execute ${toolName}: ${JSON.stringify(executeBody)}`).toBe(403);
        expect(executeBody?.success).toBe(false);
        expect(executeBody?.error ?? '').toContain('Insufficient permissions');
      } else {
        test.info().annotations.push({
          type: 'skip-subcase',
          description:
            'no agent tool (defineAgentTool / mcpTool) for an agent requiring features the role lacks is registered in this app, so only the agent list and run-object denial were asserted',
        });
      }
    } finally {
      if (apiKeyId) {
        await apiRequest(request, 'DELETE', `/api/api_keys/keys?id=${encodeURIComponent(apiKeyId)}`, {
          token: adminToken,
        }).catch(() => undefined);
      }
      await deleteRoleIfExists(request, adminToken, roleId);
    }
  });
});
