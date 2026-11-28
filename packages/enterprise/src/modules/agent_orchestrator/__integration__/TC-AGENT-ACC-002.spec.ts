import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  AGENT_RUN_FEATURE,
  GATED_AGENT_ID,
  GATED_AGENT_INPUT,
  GATED_AGENT_TOOL,
  RUN_OBJECT_PATH,
  TOOLS_EXECUTE_PATH,
  createScopedAgentUser,
  deleteScopedAgentUser,
  type ScopedAgentUser,
} from './helpers/agentAccessFixtures'

/**
 * TC-AGENT-ACC-002: the ai-assistant doors refuse an orchestrator agent the caller may not invoke.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-10-21-agent-invocation-access-and-identity-binding.md
 * (Integration: `POST /api/ai_assistant/ai/run-object` with the AO agent id; MCP / chat
 * tool built with `defineAgentTool`).
 *
 * The caller holds `ai_assistant.view` + `agent_orchestrator.agents.run` but not
 * `agent_orchestrator.agents.view`, which `support.ticket_triage` requires:
 *   - `run-object` answers 403 `agent_features_denied` before the dispatcher runs
 *     anything (no model call, no `AgentRun` row);
 *   - the `agent_examples.triage_ticket` agent tool requires the same feature, so
 *     `/tools/execute` refuses it at the tool ACL (403) and never reaches the agent.
 *
 * Self-contained: creates its own role and user; deletes them in `finally`.
 */

type RunObjectErrorBody = { error?: string; code?: string; agentRunId?: unknown }
type ExecuteErrorBody = { success?: boolean; error?: string }

test.describe('TC-AGENT-ACC-002: ai-assistant doors honour the agent invoke permission', () => {
  test('run-object and the agent tool refuse a caller without the agent feature', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    let caller: ScopedAgentUser | null = null
    try {
      caller = await createScopedAgentUser(request, adminToken, {
        label: 'assistant-no-view',
        features: ['ai_assistant.view', AGENT_RUN_FEATURE],
      })

      const runObject = await apiRequest(request, 'POST', RUN_OBJECT_PATH, {
        token: caller.token,
        data: {
          agent: GATED_AGENT_ID,
          messages: [{ role: 'user', content: JSON.stringify(GATED_AGENT_INPUT) }],
        },
      })
      const runObjectRaw = await runObject.text()
      expect(runObject.status(), runObjectRaw).toBe(403)
      const runObjectBody = JSON.parse(runObjectRaw) as RunObjectErrorBody
      expect(runObjectBody.code).toBe('agent_features_denied')
      expect(runObjectBody.agentRunId).toBeUndefined()

      const execute = await apiRequest(request, 'POST', TOOLS_EXECUTE_PATH, {
        token: caller.token,
        data: { toolName: GATED_AGENT_TOOL, args: GATED_AGENT_INPUT },
      })
      expect(execute.status(), 'the agent tool requires the agent feature').toBe(403)
      const executeBody = await readJsonSafe<ExecuteErrorBody>(execute)
      expect(executeBody?.success).toBe(false)
      expect(executeBody?.error ?? '').toContain('Insufficient permissions')
    } finally {
      await deleteScopedAgentUser(request, adminToken, caller)
    }
  })
})
