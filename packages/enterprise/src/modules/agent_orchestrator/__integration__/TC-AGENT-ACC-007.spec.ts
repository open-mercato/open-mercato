import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  AGENT_RUN_FEATURE,
  GATED_AGENT_FEATURE,
  GATED_AGENT_ID,
  GATED_AGENT_INPUT,
  TOOLS_EXECUTE_PATH,
  createScopedAgentUser,
  deleteScopedAgentUser,
  type ScopedAgentUser,
} from './helpers/agentAccessFixtures'

/**
 * TC-AGENT-ACC-007: `delegate_agent` never launders an agent the caller may not invoke.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-10-21-agent-invocation-access-and-identity-binding.md
 * (Integration: `delegate_agent` via a parent agent — the child returns
 * `agent_invoke_denied` as data).
 *
 * The delegate tool (`agent_orchestrator.delegate_agent`) is a registered
 * ai-assistant tool, so `/api/ai_assistant/tools/execute` reaches its handler
 * without a model. Delegation is scoped to the `subAgents` the CALLING agent
 * declares (B-13), and the calling agent is resolved server-side from the run
 * context or run session. A direct call through `tools/execute` belongs to no
 * agent run, so it is refused with `{ ok: false, error: 'no_active_run' }` as
 * data — even for a caller who could invoke the target — before any child run
 * is admitted. The tool ACL still applies first (403 without
 * `agent_orchestrator.agents.run`).
 *
 * The invoke-permission denial for a child delegated from a real parent run
 * (`agent_invoke_denied` as data) is covered by the unit suites
 * `agent-invoke-entry-points.test.ts` and `agent-invoke-access.test.ts`, which
 * bind a parent agent the way the runners do.
 *
 * Model-dependent (skipped): "the parent run still completes" needs the parent
 * agent's model loop to call the tool.
 *
 * Self-contained: creates its own role and user; deletes them in `finally`.
 */

const DELEGATE_TOOL = 'agent_orchestrator.delegate_agent'
const NO_ACTIVE_RUN_CODE = 'no_active_run'

type DelegateResult = { ok?: boolean; agentId?: string; error?: string; data?: unknown }
type ExecuteBody = { success?: boolean; result?: DelegateResult; error?: string }

test.describe('TC-AGENT-ACC-007: delegate_agent honours the agent invoke permission and the parent scope', () => {
  test('a call outside any agent run is refused with no_active_run as data', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    let caller: ScopedAgentUser | null = null
    try {
      caller = await createScopedAgentUser(request, adminToken, {
        label: 'delegate-no-parent',
        features: ['ai_assistant.view', AGENT_RUN_FEATURE, GATED_AGENT_FEATURE],
      })

      const response = await apiRequest(request, 'POST', TOOLS_EXECUTE_PATH, {
        token: caller.token,
        data: { toolName: DELEGATE_TOOL, args: { agentId: GATED_AGENT_ID, input: GATED_AGENT_INPUT } },
      })
      const raw = await response.text()
      expect(response.status(), raw).toBe(200)
      const body = JSON.parse(raw) as ExecuteBody
      expect(body.success).toBe(true)
      expect(body.result).toEqual({ ok: false, agentId: GATED_AGENT_ID, error: NO_ACTIVE_RUN_CODE })
      expect(raw, 'the agent required features are never echoed').not.toContain(GATED_AGENT_FEATURE)
    } finally {
      await deleteScopedAgentUser(request, adminToken, caller)
    }
  })

  test('the delegate tool itself still requires agent_orchestrator.agents.run', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    let caller: ScopedAgentUser | null = null
    try {
      caller = await createScopedAgentUser(request, adminToken, {
        label: 'delegate-no-run',
        features: ['ai_assistant.view', GATED_AGENT_FEATURE],
      })

      const response = await apiRequest(request, 'POST', TOOLS_EXECUTE_PATH, {
        token: caller.token,
        data: { toolName: DELEGATE_TOOL, args: { agentId: GATED_AGENT_ID, input: GATED_AGENT_INPUT } },
      })
      expect(response.status(), 'the tool ACL refuses before the handler runs').toBe(403)
      const body = await readJsonSafe<ExecuteBody>(response)
      expect(body?.success).toBe(false)
    } finally {
      await deleteScopedAgentUser(request, adminToken, caller)
    }
  })

  test('a parent run completes when one delegated child is denied', async () => {
    test.skip(
      true,
      'needs a model: only a parent agent model loop calls delegate_agent inside a run; the denial itself is asserted above',
    )
  })
})
