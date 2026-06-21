import type { AiAgentDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-agent-definition'
import { defineAgent } from './lib/sdk/defineAgent'
import { dealHealthCheckResult } from './data/validators'

// `deals.health_check` is the demo agent for the MVP end-to-end flow (area 05).
// Authoring is code (here), not a DB seed: the ai_assistant generator discovers
// `ai-agents.ts` and `defineAgent` emits a standard AiAgentDefinition (object
// mode) while registering { id, resultKind, schema } in the area-01 registry.
// The id is the STABLE contract id referenced by the demo workflow definition's
// INVOKE_AGENT step (`examples/deals-health-check-workflow.json`) and the
// runbook in mvp/05-seed-and-demo.md.
//
// Result: an `actionable` proposal carrying a single `set_stage` action plus a
// confidence score. The disposition gate (area 03) auto-approves when
// `confidence >= autoApproveThreshold` (0.8 on the demo node) and otherwise
// raises a USER_TASK / proposal for an operator. The effector step applies the
// approved `set_stage` payload to the deal via the audited customers command.
export const aiAgents: AiAgentDefinition[] = [
  defineAgent({
    id: 'deals.health_check',
    moduleId: 'agent_orchestrator',
    label: 'Deal health check',
    description: 'Assess a deal’s health and propose the single best next stage.',
    instructions: [
      'You assess the health of a sales deal and propose the single best next action.',
      'Inspect the deal referenced by the input `dealId`: its stage, value, probability,',
      'recent activity and time in stage.',
      'Always return an actionable proposal with exactly one `set_stage` action whose',
      'payload sets the next pipeline stage (e.g. { "stage": "Qualified" }).',
      'Set `confidence` between 0 and 1: high (>= 0.8) when the next stage is unambiguous,',
      'lower when a human should review. Use `rationale` to explain the recommendation.',
    ].join(' '),
    tools: [],
    result: { kind: 'actionable', schema: dealHealthCheckResult },
  }),
]

export default aiAgents
