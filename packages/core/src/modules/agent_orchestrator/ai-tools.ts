import { z } from 'zod'
import { defineAiTool } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-tool-definition'
import type { AiToolDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import { DELEGATE_TOOL_ID, getAgentEntry, ensureAgentsLoaded } from './lib/sdk/defineAgent'
import type { AgentRuntimeService } from './lib/runtime/agentRuntime'

const delegateInput = z.object({
  agentId: z.string().min(1).describe('Id of the sub-agent to run (must be an informative agent).'),
  input: z.unknown().describe('Input payload passed to the sub-agent (shape is sub-agent specific).'),
})

/**
 * Sub-agent-as-tool: lets a parent agent run another agent as a read-only
 * sub-agent and fan several out in parallel (the model emits multiple calls in
 * one step; the SDK runs them concurrently). Propose-only is preserved:
 *
 *  - the tool is `isMutation: false` — never gated, never a write;
 *  - the target MUST be an `informative` agent (sub-agents inform; only the
 *    parent proposes), so no nested proposals are created;
 *  - the target may NOT itself delegate (no `subAgents`), which caps tree depth
 *    at one and prevents cycles;
 *  - the sub-agent runs under the SAME caller scope/ACL — never escalated.
 *
 * Errors are returned as data (`{ ok: false }`) so one failed sub-task never
 * crashes the parent loop.
 */
const delegateAgentTool: AiToolDefinition = {
  name: DELEGATE_TOOL_ID,
  displayName: 'Delegate to sub-agent',
  description:
    'Run another agent as a read-only sub-agent and return its result. Only informative, non-delegating agents may be targeted. Call multiple times in one step to fan out in parallel.',
  inputSchema: delegateInput,
  requiredFeatures: ['agent_orchestrator.agents.run'],
  isMutation: false,
  tags: ['read', 'agent_orchestrator'],
  async handler(rawInput, ctx) {
    const { agentId, input } = delegateInput.parse(rawInput)
    if (!ctx.tenantId || !ctx.organizationId || !ctx.userId) {
      return { ok: false as const, agentId, error: 'missing tenant/org/user scope' }
    }

    await ensureAgentsLoaded()
    const entry = getAgentEntry(agentId)
    if (!entry) {
      return { ok: false as const, agentId, error: `unknown sub-agent "${agentId}"` }
    }
    if (entry.resultKind !== 'informative') {
      return { ok: false as const, agentId, error: 'only informative sub-agents may be delegated to' }
    }
    if (entry.subAgents.length > 0) {
      return { ok: false as const, agentId, error: 'sub-agents may not delegate further (depth capped at 1)' }
    }

    try {
      const agentRuntime = ctx.container.resolve('agentRuntime') as AgentRuntimeService
      const result = await agentRuntime.run(agentId, input, {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        userId: ctx.userId,
      })
      const data = result.kind === 'informative' ? result.data : result.proposal
      return { ok: true as const, agentId, data }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false as const, agentId, error: message }
    }
  },
}

export const aiTools: AiToolDefinition[] = [delegateAgentTool]

export default aiTools
