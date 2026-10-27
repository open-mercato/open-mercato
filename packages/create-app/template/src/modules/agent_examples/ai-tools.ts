import { z } from 'zod'
import { defineAgentTool } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-tool'
import type { AiToolDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import { ticketTriageResult } from './data/validators'

/**
 * Publishes the `support.ticket_triage` Agent Orchestrator agent as one tool.
 *
 * `defineAgentTool` makes the agent callable from every tool door (MCP
 * `tools/list` + `tools/call`, `/api/ai_assistant/tools/execute`, chat). The
 * agent is owned by the Agent Orchestrator, so each call is routed through the
 * orchestrator's run dispatcher: the per-agent invoke check, principal binding,
 * guardrails and trace capture apply exactly as on the orchestrator run route,
 * and the result carries `agentRunId` (with `runId: null`).
 *
 * `requiredFeatures` repeats the agent's own `requiredFeatures` — a tool must
 * require at least what its agent requires. When `agent_orchestrator` is not
 * enabled, no dispatcher owns the agent: the tool is hidden from `tools/list`
 * and a direct call fails with `AGENT_DISPATCHER_UNAVAILABLE`.
 *
 * The tool name is a stable contract id once published.
 */
export const ticketTriageInput = z.object({
  subject: z.string().min(1).max(500).describe('Ticket subject line'),
  body: z.string().min(1).max(8000).describe('Ticket body text'),
})

export const triageTicketTool = defineAgentTool({
  name: 'agent_examples.triage_ticket',
  description:
    'Classify a support ticket into a category and priority with a one-line summary (runs the support.ticket_triage agent).',
  agentId: 'support.ticket_triage',
  inputSchema: ticketTriageInput,
  outputSchema: ticketTriageResult.shape.data,
  requiredFeatures: ['agent_orchestrator.agents.view'],
})

export const aiTools: AiToolDefinition[] = [triageTicketTool as AiToolDefinition]

export default aiTools
