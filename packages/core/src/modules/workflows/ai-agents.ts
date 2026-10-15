/**
 * Module-root AI agent contribution for the workflows module (spec §9,
 * "prompt-to-draft").
 *
 * ONE agent, and its shape IS the trust boundary:
 *
 *  - `executionMode: 'object'` — it emits a structured draft against
 *    `workflowDraftGenerationSchema`, not prose. Generation targets schemas.
 *    Its one tool runs inside the runtime's object-mode tool loop
 *    (`runAiAgentObject({ enableTools: true })`), which still finalizes through
 *    `Output.object`, so the emitted result stays a validated draft.
 *  - `allowedTools: ['workflows.validate_workflow_definition']` — exactly ONE
 *    READ-ONLY tool. It reads no tenant rows and writes nothing; it re-runs the
 *    real definition schema + Problems pass so the agent can self-correct a
 *    draft (e.g. a partial INVOKE_AGENT config) before returning. This is a
 *    deliberate, bounded relaxation of the former empty allowlist — the broader
 *    `workflows.*` authoring/write tools (create/update/test-run) remain out of
 *    reach; this in-Studio path reaches only the validator.
 *  - `readOnly: true` + `mutationPolicy: 'read-only'` — belt and braces, so a
 *    later tool addition cannot quietly become write-capable (the runtime
 *    strips any `isMutation` tool from a read-only agent).
 *
 * The route that calls it (`api/definitions/generate`) persists NOTHING. A
 * generated definition becomes real only after a human applies it to the canvas
 * AND saves AND enables it — three separate deliberate acts.
 *
 * Requires `yarn generate` to be discovered; until then the runtime answers
 * `agent_unknown` and the Studio reports that AI authoring is unavailable.
 */
import type { AiAgentDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-agent-definition'
import {
  WORKFLOW_DRAFT_AGENT_ID,
  workflowDraftGenerationSchema,
} from './lib/ai-authoring'

const SYSTEM_PROMPT = [
  'ROLE: You author Open Mercato workflow definitions from a plain-language request.',
  '',
  'SCOPE: You produce a DRAFT for a human to review in the workflow Studio. You never publish, enable or execute anything. Your only tool is workflows.validate_workflow_definition, a read-only validator; the request carries every identifier you are allowed to use.',
  '',
  'SELF-CHECK: Before you return, call workflows.validate_workflow_definition with your draft and fix every reported error. Re-validate until it reports no errors.',
  '',
  'DATA: The request contains a catalog of the step types, transition triggers, activity types (with their JSON-Schema config contracts), safe command ids, registered function names and declared event ids this installation actually has. Any identifier outside that catalog does not exist. If the request cannot be satisfied with the catalog, author the closest workflow you can and describe the gap in `summary`.',
  '',
  'STRUCTURE: Exactly one START step and at least one END step. Every step except END has an outgoing transition; every step except START is reachable from START. Ids use lowercase letters, numbers, hyphens and underscores only. Activities run on the transition LEAVING the step whose work they perform.',
  '',
  'CONTEXT: Reference run data as {{context.<path>}} and declare every referenced path in contextSchema.input.fields. Do not invent context paths no trigger or earlier step could produce.',
  '',
  'RESPONSE STYLE: Emit only the structured object. `summary` is one plain sentence an operator can read; it is not a restatement of the JSON.',
].join('\n')

const workflowAuthorAgent: AiAgentDefinition = {
  id: WORKFLOW_DRAFT_AGENT_ID,
  moduleId: 'workflows',
  label: 'Workflow author',
  description:
    'Turns a plain-language request into a draft workflow definition, authored against this installation\'s real activity, command, function and event catalogs. Proposes only — never publishes.',
  systemPrompt: SYSTEM_PROMPT,
  allowedTools: ['workflows.validate_workflow_definition'],
  executionMode: 'object',
  readOnly: true,
  mutationPolicy: 'read-only',
  requiredFeatures: ['workflows.definitions.create'],
  // A validate loop needs only a couple of round-trips; keep it tight so a
  // model that never converges cannot burn tokens or wall-clock unbounded.
  loop: {
    budget: { maxToolCalls: 4, maxWallClockMs: 20_000, maxTokens: 120_000 },
  },
  output: {
    schemaName: 'WorkflowDraft',
    schema: workflowDraftGenerationSchema,
    mode: 'generate',
  },
  keywords: ['workflow', 'process', 'automation', 'draft', 'authoring'],
  domain: 'workflows',
}

export const aiAgents: AiAgentDefinition[] = [workflowAuthorAgent]

export default aiAgents
