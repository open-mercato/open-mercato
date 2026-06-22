import type { AiAgentDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-agent-definition'
import { defineAgent } from '@open-mercato/core/modules/agent_orchestrator/lib/sdk/defineAgent'
import { ticketTriageResult } from './data/validators'

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
]

export default aiAgents
