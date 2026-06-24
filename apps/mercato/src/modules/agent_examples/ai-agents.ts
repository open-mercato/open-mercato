import type { AiAgentDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-agent-definition'
import { defineAgent } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/sdk/defineAgent'
import { ticketTriageResult, triageBatchResult } from './data/validators'

// `support.ticket_triage` is a fully self-contained example agent declared in a
// NEW app module (`agent_examples`). It shows the minimum needed to ship an
// Agent Orchestrator agent from any module:
//   1. a Zod result schema in data/validators.ts,
//   2. a defineAgent(...) call in this file,
//   3. registering the module in apps/mercato/src/modules.ts,
//   4. `yarn generate`.
//
// It is INFORMATIVE (returns data, proposes nothing) and uses NO tools — it
// reasons purely over the input it is given. The agent appears in
// Backend → Agents and can be run from the Playground with input like:
//   { "subject": "Charged twice this month", "body": "I see two charges ..." }
export const aiAgents: AiAgentDefinition[] = [
  defineAgent({
    id: 'support.ticket_triage',
    moduleId: 'agent_examples',
    label: 'Support ticket triage',
    description: 'Classify a support ticket into a category and priority with a one-line summary.',
    instructions: [
      'You triage inbound customer support tickets. The input contains the ticket as `subject`',
      'and `body`. Reason ONLY over that text — you have no tools and cannot look anything up.',
      'Return an informative result with three fields:',
      '`category` — one of billing, technical, account, feedback, other;',
      '`priority` — one of low, medium, high, urgent (urgent for outages, data loss, security,',
      'or money problems; low for general questions or praise);',
      'and `summary` — a single concise sentence (max ~20 words) describing the issue.',
      'Every field is REQUIRED. Never invent details that are not in the ticket.',
    ].join(' '),
    result: { kind: 'informative', schema: ticketTriageResult },
  }),

  // `support.triage_batch` is a MANAGER agent that demonstrates the
  // sub-agent-as-tool pattern. It delegates each ticket to the
  // `support.ticket_triage` sub-agent — fanning them out in parallel — then
  // aggregates. Declaring `subAgents` auto-adds the read-only delegate tool and
  // a prompt section listing the allowed sub-agents. Still propose-only: nobody
  // writes; sub-agents only inform.
  defineAgent({
    id: 'support.triage_batch',
    moduleId: 'agent_examples',
    label: 'Support triage (batch)',
    description: 'Triage a batch of support tickets by delegating each to the ticket-triage sub-agent in parallel.',
    instructions: [
      'You triage a BATCH of support tickets. The input has `tickets`: an array of objects with',
      '`subject` and `body`. For EACH ticket, delegate to the `support.ticket_triage` sub-agent by',
      'calling the delegate tool with { agentId: "support.ticket_triage", input: <that ticket> }.',
      'Issue all delegate calls in the SAME step so they run in parallel — do not triage tickets',
      'yourself. Each delegate call returns `{ ok, data: { category, priority, summary } }`.',
      'Then aggregate: return `total` (number of tickets), `urgentCount` (how many have priority',
      '"urgent"), and `items` (one entry per ticket with its subject plus the sub-agent’s category,',
      'priority and summary). Every field is REQUIRED.',
    ].join(' '),
    subAgents: ['support.ticket_triage'],
    result: { kind: 'informative', schema: triageBatchResult },
  }),
]

export default aiAgents
