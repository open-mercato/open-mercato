import { z } from 'zod'
import { defineAiTool } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-tool-definition'
import type { AiToolDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'

// A self-contained READ-ONLY tool for the file-defined example agent
// `support.resolution_advisor` (see agents/support_resolution_advisor/). It
// returns a canned support history so the example runs without any DB/tenant
// wiring. A real tool would query the customers/support modules and gate on
// their own feature (e.g. `customers.view`); we gate on the agent-run feature so
// the example is runnable by anyone who can run the agent in the Playground.
//
// `isMutation: false` is REQUIRED: the file-agent propose-only gate rejects any
// agent that declares a mutation tool, and the OpenCode MCP allowlist only ever
// exposes read tools. The agent reads history here, then PROPOSES an action — it
// never writes.
const lookupInput = z.object({
  customerEmail: z
    .string()
    .min(1)
    .describe('The email of the customer whose recent support history to look up.'),
})

type TicketHistory = {
  openTickets: number
  resolvedLast30Days: number
  averageResolutionHours: number
  churnRisk: 'low' | 'medium' | 'high'
  vip: boolean
}

const CANNED_HISTORY: Record<string, TicketHistory> = {
  'vip@acme.test': {
    openTickets: 3,
    resolvedLast30Days: 1,
    averageResolutionHours: 41,
    churnRisk: 'high',
    vip: true,
  },
  'casual@example.test': {
    openTickets: 0,
    resolvedLast30Days: 2,
    averageResolutionHours: 6,
    churnRisk: 'low',
    vip: false,
  },
}

const DEFAULT_HISTORY: TicketHistory = {
  openTickets: 1,
  resolvedLast30Days: 1,
  averageResolutionHours: 18,
  churnRisk: 'medium',
  vip: false,
}

const lookupTicketHistoryTool: AiToolDefinition = {
  name: 'agent_examples.lookup_ticket_history',
  displayName: 'Look up ticket history',
  description:
    'Return a recent support history snapshot (open/resolved counts, average resolution time, churn risk, VIP flag) for a customer by email. Read-only.',
  inputSchema: lookupInput,
  requiredFeatures: ['agent_orchestrator.agents.run'],
  isMutation: false,
  tags: ['read', 'agent_examples'],
  async handler(rawInput) {
    const { customerEmail } = lookupInput.parse(rawInput)
    const history = CANNED_HISTORY[customerEmail.trim().toLowerCase()] ?? DEFAULT_HISTORY
    return { customerEmail, history }
  },
}

export const aiTools: AiToolDefinition[] = [lookupTicketHistoryTool]

export default aiTools
