import type { AiAgentDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-agent-definition'
import { defineAgent } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/sdk/defineAgent'
import { policyCheckResult, ticketTriageResult, triageBatchResult } from './data/validators'
import { GET_SUPPORT_POLICY_TOOL_ID, policyCheckIntegrity } from './lib/policyCheckIntegrity'
import { SUPPORT_POLICY_SET_VERSION } from './lib/supportPolicies'

// `support.ticket_triage` is a fully self-contained example agent declared in a
// NEW app module (`agent_examples`). It shows the minimum needed to ship an
// Agent Orchestrator agent from any module:
//   1. a Zod result schema in data/validators.ts,
//   2. a defineAgent(...) call in this file,
//   3. registering the module in apps/mercato/src/modules.ts,
//   4. `yarn generate`.
//
// It is RESEARCHER (returns data, proposes nothing) and uses NO tools — it
// reasons purely over the input it is given. The agent appears in
// Backend → Agents and can be run from the Playground with input like:
//   { "subject": "Charged twice this month", "body": "I see two charges ..." }
//
// `requiredFeatures` is the per-agent invoke permission: every door (run route,
// Playground, delegate, workflow, eval, ai-assistant run-object, MCP tool,
// agent-token route) checks the caller holds these features. `ai-tools.ts`
// exposes this agent as the `agent_examples.triage_ticket` tool.
export const aiAgents: AiAgentDefinition[] = [
  defineAgent({
    id: 'support.ticket_triage',
    moduleId: 'agent_examples',
    label: 'Support ticket triage',
    description: 'Classify a support ticket into a category and priority with a one-line summary.',
    requiredFeatures: ['agent_orchestrator.agents.view'],
    instructions: [
      'You triage inbound customer support tickets. The input contains the ticket as `subject`',
      'and `body`. Reason ONLY over that text — you have no tools and cannot look anything up.',
      'Return a research result with three fields:',
      '`category` — one of billing, technical, account, feedback, other;',
      '`priority` — one of low, medium, high, urgent (urgent for outages, data loss, security,',
      'or money problems; low for general questions or praise);',
      'and `summary` — a single concise sentence (max ~20 words) describing the issue.',
      'Every field is REQUIRED. Never invent details that are not in the ticket.',
    ].join(' '),
    result: { kind: 'research', schema: ticketTriageResult },
    sampleInput: {
      subject: 'Charged twice this month',
      body: 'Hi, I was billed for two subscriptions this month but I only have one account. Please refund the duplicate charge.',
    },
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
    result: { kind: 'research', schema: triageBatchResult },
    sampleInput: {
      tickets: [
        {
          subject: 'Charged twice this month',
          body: 'I was billed for two subscriptions this month but I only have one account. Please refund the duplicate charge.',
        },
        {
          subject: 'How do I export my data?',
          body: 'I would like to download a CSV of my orders for last quarter. Where can I find that?',
        },
        {
          subject: 'Site is completely down',
          body: 'Our whole team is getting 500 errors on every page since this morning. This is blocking all of us.',
        },
      ],
    },
  }),

  // `support.policy_check` demonstrates OUTPUT-INTEGRITY rules. The model's
  // findings are checked deterministically after the schema passes: quotes must
  // be verbatim in the reply, cited policy ids must exist at the input's
  // policy-set version (resolver registered in di.ts), and each cited policy
  // must have been read with the lookup tool. See README → Output integrity.
  defineAgent({
    id: 'support.policy_check',
    moduleId: 'agent_examples',
    label: 'Support reply policy check',
    description: 'Check a drafted support reply against the support policies and quote every breach.',
    requiredFeatures: ['agent_orchestrator.agents.view'],
    instructions: [
      'You check a drafted customer support reply against the support policies. The input has',
      '`reply` (the reply text) and `policySetVersion`. The policy ids are: no-credentials,',
      'refund-window, no-delivery-dates, escalate-outages. Read each policy you rely on with the',
      `\`${GET_SUPPORT_POLICY_TOOL_ID}\` tool before citing it. Return \`findings\`: one entry per`,
      'broken policy with `policyId`, a short `explanation`, `evidence` (one or more items whose',
      '`quote` is copied VERBATIM from the reply, with `start`/`end` character offsets into it) and',
      '`confidence` between 0 and 1. Return an empty `findings` array when the reply breaks no policy.',
      'Never cite a policy you did not read and never paraphrase a quote.',
    ].join(' '),
    tools: [GET_SUPPORT_POLICY_TOOL_ID],
    result: { kind: 'research', schema: policyCheckResult },
    integrity: policyCheckIntegrity,
    sampleInput: {
      reply: 'Sorry about the double charge! Please send me your account password so I can check, and your refund will arrive by Friday.',
      policySetVersion: SUPPORT_POLICY_SET_VERSION,
    },
  }),
]

export default aiAgents
